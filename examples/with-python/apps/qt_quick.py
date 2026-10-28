"""Real Qt Quick Controls reference with explicit accessible names."""

import sys

if "--pyqt6" in sys.argv:
    from PyQt6.QtGui import QGuiApplication
    from PyQt6.QtQml import QQmlApplicationEngine
else:
    from PySide6.QtGui import QGuiApplication
    from PySide6.QtQml import QQmlApplicationEngine

QML = b"""
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
ApplicationWindow {
    visible: true; width: 400; height: 280; title: "Python Quick E2E reference"
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 24
        TextField { id: nameInput; objectName: "input"; Accessible.name: "Name"; Layout.fillWidth: true }
        CheckBox { text: "Remember"; Accessible.name: "Remember" }
        Button { text: "Submit"; Accessible.name: "Submit"; onClicked: result.text = plantedWrong ? "wrong output" : "Hello " + nameInput.text }
        TextField { id: result; objectName: "result"; Accessible.name: "Result"; readOnly: true; Layout.fillWidth: true }
    }
}
"""

if __name__ == "__main__":
    application = QGuiApplication(sys.argv)
    engine = QQmlApplicationEngine()
    engine.rootContext().setContextProperty("plantedWrong", "--wrong" in sys.argv)
    engine.loadData(QML)
    if not engine.rootObjects():
        raise SystemExit(2)
    raise SystemExit(application.exec())
