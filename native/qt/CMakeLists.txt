cmake_minimum_required(VERSION 3.16)
project(e2e_qt_bridge VERSION 0.1.0 LANGUAGES CXX)

include(CTest)
set(E2E_QT_TEST_QPA "$ENV{QT_QPA_PLATFORM}" CACHE STRING "QPA platform for all Qt acceptance tests")
if(NOT E2E_QT_TEST_QPA)
  set(E2E_QT_TEST_QPA offscreen CACHE STRING "QPA platform for all Qt acceptance tests" FORCE)
endif()
# Native macOS Quick controls require a Cocoa window. Headless acceptance uses
# Basic; this test-only setting never changes a consuming application's style.
set(E2E_QT_TEST_STYLE "$ENV{QT_QUICK_CONTROLS_STYLE}" CACHE STRING "Quick Controls style for Qt acceptance tests")
if(APPLE AND E2E_QT_TEST_QPA STREQUAL "offscreen" AND NOT E2E_QT_TEST_STYLE)
  set(E2E_QT_TEST_STYLE Basic CACHE STRING "Quick Controls style for Qt acceptance tests" FORCE)
endif()
set(E2E_QT_TEST_ENV "QT_QPA_PLATFORM=${E2E_QT_TEST_QPA};QT_QUICK_BACKEND=software")
if(E2E_QT_TEST_STYLE)
  list(APPEND E2E_QT_TEST_ENV "QT_QUICK_CONTROLS_STYLE=${E2E_QT_TEST_STYLE}")
endif()
include(GNUInstallDirs)
include(CMakePackageConfigHelpers)
include(GenerateExportHeader)
find_package(Qt6 6.2 REQUIRED COMPONENTS Widgets Network Test)
option(E2E_QT_WITH_QUICK "Build the Qt Quick adapter when Qt Quick is installed" ON)
if(E2E_QT_WITH_QUICK)
  find_package(Qt6 6.2 QUIET COMPONENTS Quick Qml)
endif()

set(E2E_QT_SURFACE_SOURCES src/support.cpp src/surface.cpp src/capture_guard.cpp src/control_adapters.cpp
  src/adapters/widgets_adapter.cpp src/adapters/widget_targets.cpp src/tracked_tabs.cpp)
if(E2E_QT_WITH_QUICK AND TARGET Qt6::Quick AND TARGET Qt6::Qml)
  list(APPEND E2E_QT_SURFACE_SOURCES src/adapters/quick_adapter.cpp)
endif()
add_library(e2e_qt_bridge src/bridge.cpp src/protocol/bridge_server.cpp ${E2E_QT_SURFACE_SOURCES})
add_library(E2E::QtBridge ALIAS e2e_qt_bridge)
target_compile_features(e2e_qt_bridge PUBLIC cxx_std_17)
set_target_properties(e2e_qt_bridge PROPERTIES EXPORT_NAME QtBridge AUTOMOC ON)
generate_export_header(e2e_qt_bridge EXPORT_FILE_NAME ${CMAKE_CURRENT_BINARY_DIR}/include/e2e/qt/export.h)
target_include_directories(e2e_qt_bridge PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}/include>)
if(NOT BUILD_SHARED_LIBS)
  target_compile_definitions(e2e_qt_bridge PUBLIC E2E_QT_BRIDGE_STATIC_DEFINE)
endif()
target_include_directories(e2e_qt_bridge PUBLIC $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include> $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>)
target_link_libraries(e2e_qt_bridge PUBLIC Qt6::Core Qt6::Widgets PRIVATE Qt6::Network Qt6::Test)
if(E2E_QT_WITH_QUICK AND TARGET Qt6::Quick AND TARGET Qt6::Qml)
  target_compile_definitions(e2e_qt_bridge PUBLIC E2E_QT_HAS_QUICK=1)
  target_link_libraries(e2e_qt_bridge PRIVATE Qt6::Quick Qt6::Qml)
endif()

set(E2E_QT_CONFIG_QUICK OFF)
if(E2E_QT_WITH_QUICK AND TARGET Qt6::Quick AND TARGET Qt6::Qml)
  set(E2E_QT_CONFIG_QUICK ON)
endif()
configure_package_config_file(cmake/e2eQtBridgeConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/e2eQtBridgeConfig.cmake
  INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/e2eQtBridge)
write_basic_package_version_file(${CMAKE_CURRENT_BINARY_DIR}/e2eQtBridgeConfigVersion.cmake
  VERSION ${PROJECT_VERSION} COMPATIBILITY SameMajorVersion)
install(TARGETS e2e_qt_bridge EXPORT e2eQtBridgeTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/include/e2e/qt/export.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/e2e/qt)
install(DIRECTORY include/ DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})
install(EXPORT e2eQtBridgeTargets NAMESPACE E2E:: DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/e2eQtBridge)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/e2eQtBridgeConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/e2eQtBridgeConfigVersion.cmake
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/e2eQtBridge)
install(FILES LICENSE THIRD_PARTY.md
  DESTINATION ${CMAKE_INSTALL_DATADIR}/licenses/e2eQtBridge)
if(MSVC)
  target_compile_options(e2e_qt_bridge PRIVATE /W4)
else()
  target_compile_options(e2e_qt_bridge PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(BUILD_TESTING)
  set(CMAKE_AUTOMOC ON)
  add_executable(e2e_qt_bridge_tests tests/bridge_tests.cpp)
  target_compile_features(e2e_qt_bridge_tests PRIVATE cxx_std_17)
  target_link_libraries(e2e_qt_bridge_tests PRIVATE E2E::QtBridge Qt6::Widgets Qt6::Network Qt6::Test)
  if(E2E_QT_CONFIG_QUICK)
    target_link_libraries(e2e_qt_bridge_tests PRIVATE Qt6::Quick)
  endif()
  # Explicit file logging retains assertion details even on Windows GUI kits
  # whose Qt Test default output is not attached to the CTest console.
  add_test(NAME qt-bridge-protocol COMMAND e2e_qt_bridge_tests
    -o -,txt -o ${CMAKE_CURRENT_BINARY_DIR}/qt-bridge-protocol.xml,junitxml)
  set_tests_properties(qt-bridge-protocol PROPERTIES TIMEOUT 45 ENVIRONMENT "${E2E_QT_TEST_ENV}")
  if(APPLE)
    add_test(NAME qt-bridge-protocol-no-swap COMMAND e2e_qt_bridge_tests
      -o -,txt -o ${CMAKE_CURRENT_BINARY_DIR}/qt-bridge-protocol-no-swap.xml,junitxml)
    set_tests_properties(qt-bridge-protocol-no-swap PROPERTIES TIMEOUT 45
      ENVIRONMENT "${E2E_QT_TEST_ENV};E2E_QT_TEST_NO_SWAP=1")
  endif()
  # Exercise render-time changes synchronously against the same surface sources,
  # without exposing internal symbols from the installed shared library.
  add_executable(e2e_qt_surface_tests tests/surface_tests.cpp ${E2E_QT_SURFACE_SOURCES})
  target_compile_features(e2e_qt_surface_tests PRIVATE cxx_std_17)
  target_include_directories(e2e_qt_surface_tests PRIVATE include ${CMAKE_CURRENT_BINARY_DIR}/include)
  target_compile_definitions(e2e_qt_surface_tests PRIVATE E2E_QT_BRIDGE_STATIC_DEFINE)
  target_link_libraries(e2e_qt_surface_tests PRIVATE Qt6::Widgets Qt6::Test)
  if(E2E_QT_CONFIG_QUICK)
    target_compile_definitions(e2e_qt_surface_tests PRIVATE E2E_QT_HAS_QUICK=1)
    target_link_libraries(e2e_qt_surface_tests PRIVATE Qt6::Quick Qt6::Qml)
  endif()
  add_test(NAME qt-surface-privacy COMMAND e2e_qt_surface_tests)
  set_tests_properties(qt-surface-privacy PROPERTIES TIMEOUT 45
    ENVIRONMENT "${E2E_QT_TEST_ENV}")
  add_executable(e2e_qt_widgets_controls_tests tests/widgets_controls_tests.cpp ${E2E_QT_SURFACE_SOURCES})
  target_compile_features(e2e_qt_widgets_controls_tests PRIVATE cxx_std_17)
  target_include_directories(e2e_qt_widgets_controls_tests PRIVATE include ${CMAKE_CURRENT_BINARY_DIR}/include)
  target_compile_definitions(e2e_qt_widgets_controls_tests PRIVATE E2E_QT_BRIDGE_STATIC_DEFINE)
  target_link_libraries(e2e_qt_widgets_controls_tests PRIVATE Qt6::Widgets Qt6::Test)
  if(E2E_QT_CONFIG_QUICK)
    target_compile_definitions(e2e_qt_widgets_controls_tests PRIVATE E2E_QT_HAS_QUICK=1)
    target_link_libraries(e2e_qt_widgets_controls_tests PRIVATE Qt6::Quick Qt6::Qml)
  endif()
  add_test(NAME qt-widgets-controls COMMAND e2e_qt_widgets_controls_tests)
  set_tests_properties(qt-widgets-controls PROPERTIES TIMEOUT 45
    ENVIRONMENT "${E2E_QT_TEST_ENV}")
  if(E2E_QT_CONFIG_QUICK)
    add_executable(e2e_qt_quick_controls_tests tests/quick_controls_tests.cpp ${E2E_QT_SURFACE_SOURCES})
    target_compile_features(e2e_qt_quick_controls_tests PRIVATE cxx_std_17)
    target_include_directories(e2e_qt_quick_controls_tests PRIVATE include ${CMAKE_CURRENT_BINARY_DIR}/include)
    target_compile_definitions(e2e_qt_quick_controls_tests PRIVATE E2E_QT_BRIDGE_STATIC_DEFINE)
    target_compile_definitions(e2e_qt_quick_controls_tests PRIVATE E2E_QT_HAS_QUICK=1)
    target_link_libraries(e2e_qt_quick_controls_tests PRIVATE Qt6::Widgets Qt6::Test Qt6::Quick Qt6::Qml)
    add_test(NAME qt-quick-controls COMMAND e2e_qt_quick_controls_tests)
    set_tests_properties(qt-quick-controls PROPERTIES TIMEOUT 45
      ENVIRONMENT "${E2E_QT_TEST_ENV}")
  endif()
endif()
