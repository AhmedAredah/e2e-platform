// SPDX-License-Identifier: MIT
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts

ApplicationWindow {
    width: 520; height: 480; visible: true
    title: "C++ Qt Quick calculator"
    objectName: "quick-calculator"
    ColumnLayout {
        anchors.fill: parent; anchors.margins: 24; spacing: 12
        Label { text: "Qt Quick: calculate a project total" }
        TextField { id: quantity; objectName: "quantity"; text: "3"; placeholderText: "Quantity"; Accessible.name: "Quantity" }
        TextField { id: price; objectName: "unit-price"; text: "12.5"; placeholderText: "Unit price"; Accessible.name: "Unit price" }
        TextField { objectName: "password"; echoMode: TextInput.Password; placeholderText: "Project password"; Accessible.name: "Project password" }
        ComboBox {
            id: currency; objectName: "currency"; Accessible.name: "Currency"
            textRole: "label"; valueRole: "code"; currentIndex: 1
            model: [{ label: "US dollars", code: "USD" }, { label: "Euros", code: "EUR" }]
        }
        CheckBox { id: tax; objectName: "tax"; text: "Include 10% tax" }
        Button {
            id: calculate; objectName: "calculate"; text: "Calculate"
            onClicked: { enabled = false; status.text = "Calculating"; finish.start() }
        }
        Label { id: result; objectName: "result"; text: "Total: pending" }
        Label { id: status; objectName: "status"; text: "Ready" }
        Timer {
            id: finish; interval: 80
            onTriggered: {
                var total = Number(quantity.text) * Number(price.text) * (tax.checked ? 1.1 : 1.0) + (badCalculation ? 1 : 0)
                result.text = "Total: " + total.toFixed(2) + " " + currency.currentValue
                status.text = "Calculated"
                calculate.enabled = true
            }
        }
        Item { Layout.fillHeight: true }
    }
}
