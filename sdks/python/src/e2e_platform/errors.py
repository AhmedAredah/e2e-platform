"""Public failures omit application values and invalidate uncertain transports."""


class E2EError(RuntimeError):
    """Base class for SDK, protocol and remote operation failures."""


class ProtocolError(E2EError):
    """The authoring session cannot safely continue."""


class RemoteError(E2EError):
    """The shared runner rejected or failed an operation."""
