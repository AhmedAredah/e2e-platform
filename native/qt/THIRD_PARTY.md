# Qt helper dependencies

The E2E C++ Qt bridge source is licensed under MIT; see [LICENSE](LICENSE).
The helper uses the public Qt API and does not vendor a Qt source distribution.
Installing this CMake package does not install or redistribute the Qt runtime.

The bridge links to Qt Core, Widgets, Network and Test. A Quick-enabled build
also links to Qt Quick and Qml. The example QML application additionally uses
Qt Quick Controls and Layouts at runtime. Use a licensed Qt installation that
matches the application's compiler, architecture and Qt version. Qt Test has no
binary compatibility guarantee across Qt releases.

Qt libraries and their own third-party components retain their original
licenses. Their licensing is independent of the helper's MIT license. When
redistributing Qt with an application or test tool, inspect the exact Qt version,
selected modules, plugins and linking configuration, and provide the notices,
source or source offer, and other materials required by the applicable licenses.
The helper's MIT license does not satisfy those Qt redistribution obligations.

Primary references:

- [Qt licensing and third-party components](https://doc.qt.io/qt-6/licensing.html)
- [Qt Test licensing and compatibility](https://doc.qt.io/qt-6/qttest-index.html)
- [Qt open-source licensing obligations](https://www.qt.io/development/open-source-lgpl-obligations)

The Qt documentation URLs describe the current Qt release. Use the license files
and component inventory shipped with the specific Qt distribution you deploy.
