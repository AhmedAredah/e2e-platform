"""Wire and public-object regressions independent of a GUI provider."""

import io
import asyncio
import threading
from decimal import Decimal
import pytest
from e2e_platform import ProtocolError, RemoteError, Session, StdioTransport
from e2e_platform.codec import MAX_FRAME, dumps, loads


def transport(reply):
    reader = io.BytesIO(reply if isinstance(reply, bytes) else (dumps(reply) + "\n").encode())
    writer = io.BytesIO()
    return StdioTransport(reader, writer), writer


@pytest.mark.parametrize("text", [b'{"x":1,"x":2}', b'{"x":NaN}', b'"\xff"', b"[" * 65 + b"0" + b"]" * 65])
def test_strict_json_rejects_ambiguous_input(text):
    with pytest.raises(ProtocolError):
        loads(text)


def test_exact_decimal_and_large_integer_round_trip():
    value = {"large": 18446744073709551615, "fraction": Decimal("1.0000000000000001"), "tiny": Decimal("1e-9999")}
    assert loads(dumps(value)) == value
    assert "1.0000000000000001" in dumps(value)


@pytest.mark.parametrize("value", [float("inf"), Decimal("NaN"), {1: "invalid key"}, object()])
def test_serializer_refuses_non_json_values(value):
    with pytest.raises(ProtocolError):
        dumps(value)


@pytest.mark.parametrize(
    "reply",
    [
        b"",
        b"{}",
        b"\n",
        b"x" * (MAX_FRAME + 2),
        {"protocol": 2, "id": True, "result": None},
        {"protocol": 2, "id": 2, "result": None},
        {"protocol": 2, "id": 1, "result": None, "error": {}},
        b'{"protocol":2,"id":1,"result":null,"result":null}\n',
    ],
)
def test_invalid_reply_is_terminal_and_never_replayed(reply):
    channel, output = transport(reply)
    with pytest.raises(ProtocolError):
        channel.request("app.open", {})
    before = output.getvalue()
    with pytest.raises(ProtocolError):
        channel.request("app.open", {})
    assert output.getvalue() == before


def test_caught_remote_failure_cannot_continue():
    channel, output = transport({"protocol": 2, "id": 1, "error": {"message": "private value"}})
    with pytest.raises(RemoteError, match="Shared runner") as error:
        Session(channel).app.open()
    assert "private value" not in str(error.value)
    assert channel.failed
    assert len(output.getvalue().splitlines()) == 1


def test_wrong_void_acknowledgement_invalidates_session():
    channel, _ = transport({"protocol": 2, "id": 1, "result": True})
    with pytest.raises(ProtocolError):
        Session(channel).screen.get_by_test_id("save").click()
    assert channel.failed


def test_local_serialization_failure_is_sticky():
    channel, output = transport({"protocol": 2, "id": 1, "result": None})
    with pytest.raises(ProtocolError):
        Session(channel).expect_equal(float("nan"), 1)
    assert channel.failed
    assert not output.getvalue()


def test_locators_compose_and_numeric_assertions_are_independent_json_texts():
    channel, output = transport({"protocol": 2, "id": 1, "result": None})
    Session(channel).screen.get_by_role("dialog", name="Preferences").get_by_label("Name").fill("Ada")
    request = loads(output.getvalue())
    assert request["params"]["selector"] == [
        {"kind": "role", "value": "dialog", "name": "Preferences", "exact": True},
        {"kind": "label", "value": "Name", "exact": True},
    ]
    channel, output = transport({"protocol": 2, "id": 1, "result": None})
    Session(channel).expect_equal(9007199254740993, 9007199254740992)
    assert loads(output.getvalue())["params"] == {"actual": "9007199254740993", "expected": "9007199254740992"}


def test_partial_writes_finish_one_frame_without_replaying_the_operation():
    class PartialWriter(io.BytesIO):
        def write(self, data):
            return super().write(data[:3])

    writer = PartialWriter()
    channel = StdioTransport(io.BytesIO(b'{"protocol":2,"id":1,"result":null}\n'), writer)
    Session(channel).app.open()
    assert loads(writer.getvalue())["method"] == "app.open"
    assert len(writer.getvalue().splitlines()) == 1


def test_cancellation_invalidates_in_flight_mutation_without_deadlock_or_replay():
    entered, finish = threading.Event(), threading.Event()

    class BlockingReader(io.BytesIO):
        def readline(self, size=-1):
            entered.set()
            assert finish.wait(2)
            return super().readline(size)

    writer = io.BytesIO()
    channel = StdioTransport(BlockingReader(b'{"protocol":2,"id":1,"result":null}\n'), writer)
    session = Session(channel)

    async def cancel():
        task = asyncio.create_task(session.run_async(session.app.open))
        assert await asyncio.to_thread(entered.wait, 2)
        task.cancel()
        try:
            with pytest.raises(asyncio.CancelledError):
                await task
            assert channel.failed
        finally:
            finish.set()

    asyncio.run(cancel())
    with pytest.raises(ProtocolError):
        session.app.open()
    assert len(writer.getvalue().splitlines()) == 1


def test_scaffolding_preserves_existing_consumer_files(tmp_path):
    from e2e_platform.scaffold import ProjectInitializer

    (tmp_path / "package.json").write_text("{}")
    existing = tmp_path / "e2e.config.ts"
    existing.write_text("consumer configuration")
    with pytest.raises(FileExistsError):
        ProjectInitializer(tmp_path).create()
    assert existing.read_text() == "consumer configuration"
    assert not (tmp_path / "tests/python.e2e.ts").exists()
