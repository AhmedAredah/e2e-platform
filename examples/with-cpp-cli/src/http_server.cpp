#include "calculator/number.h"
// SPDX-License-Identifier: MIT
#include "calculator/http_server.h"
#include <chrono>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <locale>
#include <sstream>
#include <stdexcept>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace calculator {
namespace {
#ifdef _WIN32
using SocketHandle = SOCKET;
constexpr SocketHandle invalidSocket = INVALID_SOCKET;
using AddressLength = int;
#else
using SocketHandle = int;
constexpr SocketHandle invalidSocket = -1;
using AddressLength = socklen_t;
#endif

/** Owns Winsock initialization on Windows for the lifetime of all sockets. */
class SocketRuntime final {
public:
    SocketRuntime() {
#ifdef _WIN32
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("Winsock initialization failed");
#endif
    }
    ~SocketRuntime() {
#ifdef _WIN32
        WSACleanup();
#endif
    }
};

/** Closes every accepted socket even after malformed input or a disconnected client. */
class Socket final {
public:
    explicit Socket(SocketHandle handle) : handle_(handle) {
        if (handle_ == invalidSocket) throw std::runtime_error("socket operation failed");
    }
    ~Socket() {
#ifdef _WIN32
        closesocket(handle_);
#else
        close(handle_);
#endif
    }
    Socket(const Socket&) = delete;
    Socket& operator=(const Socket&) = delete;
    SocketHandle get() const { return handle_; }
private:
    SocketHandle handle_;
};

bool parseNumber(const std::string& text, double& value) {
    try { value = NumberParser{}.parse(text, false); return true; }
    catch (const std::exception&) { return false; }
}

/** Reads no more than 8 KiB with a deadline covering the entire request header. */
std::string readHeader(SocketHandle socket) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    std::string request;
    while (request.find("\r\n\r\n") == std::string::npos) {
        const auto remaining = std::chrono::duration_cast<std::chrono::microseconds>(deadline - std::chrono::steady_clock::now()).count();
        if (remaining <= 0) throw std::runtime_error("request header deadline");
        timeval wait{};
        wait.tv_sec = static_cast<decltype(wait.tv_sec)>(remaining / 1000000);
        wait.tv_usec = static_cast<decltype(wait.tv_usec)>(remaining % 1000000);
        fd_set readable;
        FD_ZERO(&readable);
        FD_SET(socket, &readable);
#ifdef _WIN32
        const int ready = select(0, &readable, nullptr, nullptr, &wait);
#else
        const int ready = select(socket + 1, &readable, nullptr, nullptr, &wait);
#endif
        if (ready <= 0) throw std::runtime_error("request header unavailable");
        char bytes[1024];
        const auto count = recv(socket, bytes, static_cast<int>(sizeof(bytes)), 0);
        if (count <= 0) throw std::runtime_error("client closed before complete request");
        request.append(bytes, static_cast<std::size_t>(count));
        if (request.size() > 8192) throw std::runtime_error("request header too large");
    }
    return request;
}

void writeResponse(SocketHandle socket, const HttpResponse& response) {
#ifdef _WIN32
    DWORD timeout = 2000;
    if (setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout)) != 0) throw std::runtime_error("write deadline unavailable");
#else
    timeval timeout{2, 0};
    if (setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout)) != 0) throw std::runtime_error("write deadline unavailable");
#ifdef SO_NOSIGPIPE
    const int noSignal = 1;
    if (setsockopt(socket, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, sizeof(noSignal)) != 0) throw std::runtime_error("SIGPIPE protection unavailable");
#endif
#endif
    const char* reason = response.status == 200 ? "OK" : response.status == 400 ? "Bad Request" : response.status == 405 ? "Method Not Allowed" : "Not Found";
    const std::string bytes = "HTTP/1.1 " + std::to_string(response.status) + " " + reason + "\r\nContent-Type: application/json\r\nContent-Length: " + std::to_string(response.body.size()) + "\r\nConnection: close\r\n\r\n" + response.body;
    std::size_t offset = 0;
    while (offset < bytes.size()) {
#ifdef MSG_NOSIGNAL
        constexpr int flags = MSG_NOSIGNAL;
#else
        constexpr int flags = 0;
#endif
        const auto written = send(socket, bytes.data() + offset, static_cast<int>(bytes.size() - offset), flags);
        if (written <= 0) throw std::runtime_error("response write failed");
        offset += static_cast<std::size_t>(written);
    }
}
} // namespace

CalculatorHttpHandler::CalculatorHttpHandler(const BinaryOperation& operation, bool wrongResult)
    : operation_(operation), wrongResult_(wrongResult) {}

HttpResponse CalculatorHttpHandler::handle(const std::string& method, const std::string& target) const {
    if (method != "GET") return {405, "{\"error\":\"method not allowed\"}"};
    if (target == "/health") return {200, "{\"ok\":true}"};
    if (target.rfind("/sum?", 0) != 0) return {404, "{\"error\":\"not found\"}"};
    const std::string query = target.substr(5);
    std::istringstream parts(query);
    std::string part;
    double a = 0, b = 0;
    bool hasA = false, hasB = false, valid = !query.empty() && query.back() != '&';
    while (std::getline(parts, part, '&')) {
        if (part.rfind("a=", 0) == 0 && !hasA) { hasA = true; valid = parseNumber(part.substr(2), a) && valid; }
        else if (part.rfind("b=", 0) == 0 && !hasB) { hasB = true; valid = parseNumber(part.substr(2), b) && valid; }
        else valid = false;
    }
    const double result = operation_.evaluate(a, b) + (wrongResult_ ? 1.0 : 0.0);
    if (!valid || !hasA || !hasB || !std::isfinite(result)) return {400, "{\"error\":\"invalid operands\"}"};
    std::ostringstream json;
    json.imbue(std::locale::classic());
    json << std::setprecision(17) << "{\"schemaVersion\":1,\"operation\":\"sum\",\"operands\":[" << a << ',' << b << "],\"sum\":" << result << '}';
    return {200, json.str()};
}

LoopbackHttpServer::LoopbackHttpServer(const HttpHandler& handler) : handler_(handler) {}
void LoopbackHttpServer::serve() const {
    SocketRuntime runtime;
    const Socket listener(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    if (bind(listener.get(), reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0 || listen(listener.get(), 4) != 0) throw std::runtime_error("loopback listener failed");
    AddressLength length = static_cast<AddressLength>(sizeof(address));
    if (getsockname(listener.get(), reinterpret_cast<sockaddr*>(&address), &length) != 0) throw std::runtime_error("listener address unavailable");
    std::cout << "E2E_CPP_HTTP_READY {\"port\":" << ntohs(address.sin_port) << "}" << std::endl;
    for (;;) {
        const Socket client(accept(listener.get(), nullptr, nullptr));
        try {
            const std::string header = readHeader(client.get());
            std::istringstream line(header.substr(0, header.find("\r\n")));
            std::string method, target, version, excess;
            if (!(line >> method >> target >> version) || (line >> excess) || (version != "HTTP/1.1" && version != "HTTP/1.0")) {
                writeResponse(client.get(), {400, "{\"error\":\"invalid request\"}"});
            } else {
                writeResponse(client.get(), handler_.handle(method, target));
            }
        } catch (const std::exception&) {
            // Malformed, stalled and disconnected clients are isolated to this connection.
        }
    }
}
} // namespace calculator
