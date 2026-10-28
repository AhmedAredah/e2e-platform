"""Real WSGI/ASGI reference services; credentials and state are test fixtures only."""

from abc import ABC, abstractmethod
import argparse
import json
import secrets
import socket
from socketserver import TCPServer
import threading
import time
from wsgiref.simple_server import WSGIServer, make_server


class LoopbackWsgiServer(WSGIServer):
    """Bind the reference service without consulting external reverse DNS."""

    def server_bind(self):
        TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]
        self.setup_environ()


class ApplicationState:
    def __init__(self, wrong: bool):
        self.sessions: set[str] = set()
        self.wrong = wrong

    def handle(self, path, method, cookie, body):
        if path == "/login" and method == "POST":
            if body != {"name": "Ada"}:
                return 400, {"error": "invalid request"}, None
            token = secrets.token_hex(16)
            self.sessions.add(token)
            return 200, {"loggedIn": True}, token
        if path == "/logout" and method == "POST":
            self.sessions.discard(cookie)
            return 200, {"loggedIn": False}, None
        if path == "/result" and method == "GET":
            if cookie not in self.sessions:
                return 401, {"error": "unauthorized"}, None
            return 200, {"result": 43 if self.wrong else 42}, None
        return 404, {"error": "not found"}, None


class ReferenceService(ABC):
    def __init__(self, state: ApplicationState, *, probe=False):
        self.state = state
        self.probe = probe

    @abstractmethod
    def serve(self):
        """Bind a local port, announce readiness and run until owned shutdown."""

    def announce(self, port):
        print("E2E_FRAMEWORK_READY " + json.dumps({"port": port}), flush=True)


class WsgiService(ReferenceService):
    @abstractmethod
    def application(self):
        """Create a real framework WSGI application."""

    def serve(self):
        with make_server("127.0.0.1", 0, self.application(), server_class=LoopbackWsgiServer) as server:
            self.announce(server.server_port)
            if not self.probe:
                server.serve_forever()


class FlaskService(WsgiService):
    def application(self):
        from flask import Flask, jsonify, request

        application = Flask(__name__)

        @application.route("/<path:path>", methods=["GET", "POST"])
        def route(path):
            status, body, cookie = self.state.handle(
                "/" + path,
                request.method,
                request.cookies.get("session"),
                request.get_json(silent=True),
            )
            response = jsonify(body)
            response.status_code = status
            if cookie is not None:
                response.set_cookie("session", cookie, httponly=True, samesite="Strict")
            return response

        return application


class DjangoService(WsgiService):
    def application(self):
        from django.conf import settings
        from django.core.wsgi import get_wsgi_application
        from django.http import JsonResponse
        from django.urls import re_path

        settings.configure(
            ROOT_URLCONF=__name__, ALLOWED_HOSTS=["127.0.0.1"], MIDDLEWARE=[]
        )

        def route(request, path):
            body = json.loads(request.body) if request.body else None
            status, body, cookie = self.state.handle(
                "/" + path, request.method, request.COOKIES.get("session"), body
            )
            response = JsonResponse(body, status=status)
            if cookie is not None:
                response.set_cookie("session", cookie, httponly=True, samesite="Strict")
            return response

        globals()["urlpatterns"] = [re_path(r"^(?P<path>.*)$", route)]
        return get_wsgi_application()


class FastApiService(ReferenceService):
    def serve(self):
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse
        import uvicorn

        application = FastAPI()

        @application.api_route("/{path:path}", methods=["GET", "POST"])
        async def route(path: str, request: Request):
            data = await request.body()
            status, body, cookie = self.state.handle(
                "/" + path,
                request.method,
                request.cookies.get("session"),
                json.loads(data) if data else None,
            )
            response = JSONResponse(body, status_code=status)
            if cookie is not None:
                response.set_cookie("session", cookie, httponly=True, samesite="strict")
            return response

        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(128)
            server = uvicorn.Server(
                uvicorn.Config(application, log_level="error", loop="asyncio")
            )
            worker = threading.Thread(
                target=server.run, kwargs={"sockets": [listener]}, daemon=True
            )
            worker.start()
            deadline = time.monotonic() + 5
            while not server.started:
                if not worker.is_alive() or time.monotonic() >= deadline:
                    raise RuntimeError("ASGI server did not become ready")
                time.sleep(0.01)
            self.announce(listener.getsockname()[1])
            if self.probe:
                server.should_exit = True
            worker.join()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("framework", choices=["flask", "django", "fastapi"])
    parser.add_argument("--wrong", action="store_true")
    parser.add_argument("--probe", action="store_true")
    arguments = parser.parse_args()
    service = {
        "flask": FlaskService,
        "django": DjangoService,
        "fastapi": FastApiService,
    }[arguments.framework]
    service(ApplicationState(arguments.wrong), probe=arguments.probe).serve()
