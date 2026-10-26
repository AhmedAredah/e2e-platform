#include <iostream>
#include <string>

static void render(int count) {
    std::cout << "\033[2J\033[HNative C++ terminal menu\r\n"
              << "[1] Increment  [2] Reset  [q] Quit\r\n"
              << "Count: " << count << "\r\nChoice: " << std::flush;
}

int main() {
    int count = 0;
    render(count);
    for (std::string choice; std::getline(std::cin, choice);) {
        if (choice == "q") { std::cout << "\r\nGoodbye\r\n" << std::flush; return 0; }
        if (choice == "1") ++count;
        if (choice == "2") count = 0;
        render(count);
    }
    return std::cin.eof() ? 0 : 1;
}
