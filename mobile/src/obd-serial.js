import { UsbSerial } from '@leeskies/capacitor-usb-serial';

let portId = null;
let rxBuffer = '';

function toBase64(str) {
    return btoa(str);
}
function fromBase64(b64) {
    return atob(b64);
}

async function connectAndReadRpm() {
    const { devices } = await UsbSerial.listDevices();
    const obdlink = devices.find(d => d.vendorId === 0x0403); // FTDI, OBDLink EX
    if (!obdlink) {
        console.error('OBDLink EX não encontrado');
        return;
    }

    if (!obdlink.hasPermission) {
        const perm = await UsbSerial.requestPermission({ deviceId: obdlink.deviceId });
        if (!perm.granted) {
            console.error('Permissão USB negada');
            return;
        }
    }

    const { portId: id } = await UsbSerial.open({ deviceId: obdlink.deviceId, portNum: 0 });
    portId = id;

    await UsbSerial.setParameters({
        portId,
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
    });

    UsbSerial.addListener('data', (event) => {
        if (event.portId !== portId) return;
        rxBuffer += fromBase64(event.data);
        if (rxBuffer.includes('>')) {
            const clean = rxBuffer.replace(/[\r\n>]/g, '').trim();
            rxBuffer = '';
            const bytes = parseHexResponse(clean, '410C', 2);
            if (bytes) {
                const rpm = Math.floor(((bytes[0] * 256) + bytes[1]) / 4);
                console.log('RPM:', rpm);
            }
        }
    });

    await UsbSerial.startReading({ portId });

    await initElm();
    setInterval(() => sendCmd('010C'), 100);
}

async function initElm() {
    await sendCmd('ATZ');
    await sendCmd('ATE0');
    await sendCmd('ATSP6');
}

async function sendCmd(cmd) {
    await UsbSerial.write({ portId, data: toBase64(cmd + '\r') });
}

function parseHexResponse(response, expectedPrefix, bytesNeeded) {
    if (/NODATA|ERROR|\?|SEARCHING/.test(response)) return null;
    if (!response.includes(expectedPrefix)) return null;
    const dataPart = response.split(expectedPrefix).pop();
    if (dataPart.length < bytesNeeded * 2) return null;
    const bytes = [];
    for (let i = 0; i < bytesNeeded * 2; i += 2) bytes.push(parseInt(dataPart.substr(i, 2), 16));
    return bytes;
}

connectAndReadRpm();