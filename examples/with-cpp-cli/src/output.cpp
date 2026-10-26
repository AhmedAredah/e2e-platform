// SPDX-License-Identifier: MIT
#include "calculator/writer.h"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <locale>
#include <sstream>
#include <stdexcept>

namespace calculator {
void JsonResultWriter::write(const Result& result, const std::string& path, std::ostream& output) const {
    // The only operation in this demo is sum; arbitrary strings are not JSON-encoded here.
    if (result.operation != "sum") throw std::runtime_error("unsupported JSON operation schema");
    std::ostringstream json;
    json.imbue(std::locale::classic());
    json << std::setprecision(std::numeric_limits<double>::max_digits10)
         << "{\"schemaVersion\":1,\"operation\":\"sum\",\"operands\":["
         << result.a << ',' << result.b << "],\"sum\":" << result.value << "}\n";
    if (!path.empty()) {
        std::ofstream file(std::filesystem::u8path(path), std::ios::binary | std::ios::trunc);
        if (!file) throw std::runtime_error("could not open output file");
        file << json.str();
        file.close();
        if (!file) throw std::runtime_error("could not finish output file");
    }
    output << json.str();
    output.flush();
    if (!output) throw std::runtime_error("could not write stdout");
}
}  // namespace calculator
