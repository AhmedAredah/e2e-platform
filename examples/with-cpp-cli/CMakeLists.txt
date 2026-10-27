cmake_minimum_required(VERSION 3.21)
project(e2e_cpp_cli VERSION 1.0 LANGUAGES CXX)

add_executable(e2e_cpp_calculator
  src/main.cpp
  src/options.cpp
  src/operation.cpp
  src/output.cpp
  src/application.cpp
)
target_include_directories(e2e_cpp_calculator PRIVATE include)
target_compile_features(e2e_cpp_calculator PRIVATE cxx_std_17)
set_target_properties(e2e_cpp_calculator PROPERTIES
  CXX_EXTENSIONS OFF
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
)
foreach(configuration DEBUG RELEASE RELWITHDEBINFO MINSIZEREL)
  set_target_properties(e2e_cpp_calculator PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY_${configuration} "${CMAKE_BINARY_DIR}/bin")
endforeach()
if(MINGW)
  target_link_options(e2e_cpp_calculator PRIVATE -municode)
endif()
if(MSVC)
  target_compile_options(e2e_cpp_calculator PRIVATE /W4 /permissive-)
else()
  target_compile_options(e2e_cpp_calculator PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if(BUILD_TESTING)
  add_test(NAME calculator_sum COMMAND e2e_cpp_calculator sum --a 1.5 --b 2.5)
  set_tests_properties(calculator_sum PROPERTIES PASS_REGULAR_EXPRESSION "\"sum\":4" TIMEOUT 5)
  add_test(NAME calculator_rejects_bad_number COMMAND e2e_cpp_calculator sum --a not-a-number --b 2)
  set_tests_properties(calculator_rejects_bad_number PROPERTIES WILL_FAIL TRUE TIMEOUT 5)
  add_test(NAME calculator_rejects_unknown_flag COMMAND e2e_cpp_calculator sum --a 1 --b 2 --unknown)
  set_tests_properties(calculator_rejects_unknown_flag PROPERTIES WILL_FAIL TRUE TIMEOUT 5)
endif()

# A local bounded reference server; framework-specific HTTP behavior is not implied.
add_executable(e2e_cpp_http src/http_main.cpp src/http_server.cpp src/operation.cpp)
target_include_directories(e2e_cpp_http PRIVATE include)
target_compile_features(e2e_cpp_http PRIVATE cxx_std_17)
set_target_properties(e2e_cpp_http PROPERTIES CXX_EXTENSIONS OFF)
if(WIN32)
  target_link_libraries(e2e_cpp_http PRIVATE ws2_32)
endif()
if(MSVC)
  target_compile_options(e2e_cpp_http PRIVATE /W4 /permissive-)
else()
  target_compile_options(e2e_cpp_http PRIVATE -Wall -Wextra -Wpedantic)
endif()
