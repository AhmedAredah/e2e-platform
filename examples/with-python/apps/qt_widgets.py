"""Real Qt Widgets reference; uses OS accessibility, without an injected helper."""

import sys

if "--pyqt6" in sys.argv:
    from PyQt6.QtWidgets import (
        QApplication,
        QCheckBox,
        QLineEdit,
        QPushButton,
        QVBoxLayout,
        QWidget,
    )
else:
    from PySide6.QtWidgets import (
        QApplication,
        QCheckBox,
        QLineEdit,
        QPushButton,
        QVBoxLayout,
        QWidget,
    )


class ReferenceWindow(QWidget):
    def __init__(self, *, wrong: bool = False):
        super().__init__()
        self.setWindowTitle("Python E2E reference")
        self.resize(400, 240)
        self.name = QLineEdit()
        self.name.setAccessibleName("Name")
        self.name.setObjectName("input")
        self.remember = QCheckBox("Remember")
        self.remember.setAccessibleName("Remember")
        self.submit = QPushButton("Submit")
        self.submit.setAccessibleName("Submit")
        self.result = QLineEdit()
        self.result.setAccessibleName("Result")
        self.result.setObjectName("result")
        self.result.setReadOnly(True)
        layout = QVBoxLayout(self)
        for widget in (self.name, self.remember, self.submit, self.result):
            layout.addWidget(widget)
        self.submit.clicked.connect(
            lambda: self.result.setText(
                "wrong output" if wrong else "Hello " + self.name.text()
            )
        )


if __name__ == "__main__":
    application = QApplication(sys.argv)
    window = ReferenceWindow(wrong="--wrong" in sys.argv)
    window.show()
    raise SystemExit(application.exec())
