// Interactive BLE console for a device reachable through an ESPHome Bluetooth proxy.
// Connects, subscribes to every notify-capable characteristic it finds, and drops you
// at a `ble>` prompt to read/write arbitrary handles and watch notify traffic live.
// This is what was used to confirm the head/foot motor control handles and to sanity
// check candidate command bytes against the real bed before/alongside live BLE captures.
//
// Usage:
//   BLE_HOST=<esphome-proxy-host> BLE_TARGET=<device-name-or-name-prefix> node prober.js
//   BLE_MODE=PAIR ...   (pair with the device first - some GATT servers require a
//                        bonded/encrypted link before they'll acknowledge writes)
//
// At the `ble>` prompt, type `help` for the full command list. The Commands table
// below and the "Known handles" hint text are specific to the Reverie RevCB control
// box this was built for (service db801000-f324-29c3-38d1-85c0c2e86885) - update them
// if you're pointing this at different hardware.
import { Connection } from '@2colors/esphome-native-api';
import readline from 'readline';

const { BLE_HOST, BLE_TARGET, BLE_MODE } = process.env;
if (!BLE_HOST) throw Error('Please specify the BLE_HOST');
if (!BLE_TARGET) throw Error('Please specify a BLE_TARGET');

const pair = BLE_MODE === 'PAIR';
const [searchName, searchMac] = BLE_TARGET.split('::').map((x, i) => (i === 0 ? x : x.toLowerCase()));
const connection = new Connection({ host: BLE_HOST });

// Handles that are dangerous to poke, hard-excluded (not overridable from the prompt).
// handle 3  = Generic Access "Device Name" (harmless, just pointless)
// handle 74/76 = Nordic Legacy DFU service - writing here can trigger a firmware
//                update / bootloader jump on the BLE module. Do not touch these.
const PROTECTED_HANDLES = new Set([3, 74, 76]);

// Confirmed Reverie RevCB protocol (see src/Reverie/revcb/Commands.ts for the
// production version of this table, targeted at named characteristics rather than
// raw handle numbers).
const Commands = {
  zerog: [0x01],
  antisnore: [0x02],
  flat: [0x03],
  memory1: [0x04],
  memory2: [0x05],
  memory3: [0x06],
  memory4: [0x07],
  stop: [0x00],
  up: [0x01],
  down: [0x02],
  light: (brightness) => [brightness],
};

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const parseHex = (str) =>
  str
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((b) => parseInt(b, 16));

const characteristicPropertyValues = {
  BROADCAST: 0x01,
  READ: 0x02,
  WRITE_NO_RESPONSE: 0x04,
  WRITE: 0x08,
  NOTIFY: 0x10,
  INDICATE: 0x20,
  AUTHENTICATED: 0x40,
  EXTENDED: 0x80,
};
const propNames = (properties) => {
  const names = [];
  for (const [name, value] of Object.entries(characteristicPropertyValues)) {
    if ((properties & value) === value) names.push(name);
  }
  return names;
};

let address;
let addressType;
let characteristics = []; // { handle, uuid, props }
const lastNotify = {};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'ble> ' });

const printHelp = () => {
  console.log(`
Commands:
  list                          Show discovered characteristics
  read <handle>                 Read current value of a characteristic
  w <handle> <hexbytes>         Write raw hex bytes, e.g. "w 46 02"
  wnr <handle> <hexbytes>       Write raw hex bytes, no response requested
  cmd <handle> <name> [arg]     Write a known command, e.g. "cmd 46 zerog" or "cmd 50 light 100"
                                 names: ${Object.keys(Commands).join(', ')}
  notify <handle>               (Re)subscribe to notifications on a handle
  help                          Show this help
  quit                          Disconnect and exit

Reverie RevCB handles (from the reverse-engineered protocol - see
src/Reverie/revcb/controllerBuilder.ts for the UUID -> handle mapping, since raw
handle numbers can in principle differ between individual devices/firmware):
  46 = db8010d0 (preset select: 01=ZeroG 02=AntiSnore 03=Flat 04-07=Memory1-4)
  16 = db801021 (head motor: 00=stop 01=up 02=down)
  26 = db801041 (head position, notify)
  18 = db801022 (foot motor: 00=stop 01=up 02=down)
  30 = db801042 (foot position, notify)
  50 = db8010a0 (light brightness/off, 0-100)
`);
};

const doWrite = async (handle, bytes, response = true) => {
  if (PROTECTED_HANDLES.has(handle)) {
    console.log(
      `Refusing to write to handle ${handle} (protected - use of this handle risks bricking the BLE module). Not overridable in this tool.`
    );
    return;
  }
  console.log(`-> write handle ${handle}: ${toHex(bytes)}`);
  try {
    await connection.writeBluetoothGATTCharacteristicService(address, handle, new Uint8Array(bytes), response);
  } catch (err) {
    console.error('Write failed:', err.message || err);
  }
};

const doRead = async (handle) => {
  try {
    const res = await connection.readBluetoothGATTCharacteristicService(address, handle);
    const buf = Buffer.from(res.data, 'base64');
    console.log(`<- read handle ${handle}: ${toHex(buf)}`);
  } catch (err) {
    console.error('Read failed:', err.message || err);
  }
};

const doNotifySubscribe = async (handle) => {
  await connection.notifyBluetoothGATTCharacteristicService(address, handle);
  console.log(`Subscribed to notifications on handle ${handle}`);
};

connection.on('message.BluetoothGATTNotifyDataResponse', (message) => {
  if (message.address != address) return;
  const bytes = new Uint8Array([...Buffer.from(message.data, 'base64')]);
  const hex = toHex(bytes);
  const prev = lastNotify[message.handle];
  lastNotify[message.handle] = hex;
  const changed = prev !== undefined && prev !== hex ? '  [CHANGED]' : '';
  console.log(`\n<< NOTIFY handle ${message.handle}: ${hex}${changed}`);
  rl.prompt(true);
});

const handleLine = async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  try {
    switch (cmd) {
      case '':
        break;
      case 'help':
        printHelp();
        break;
      case 'list':
        for (const c of characteristics) {
          console.log(`handle=${c.handle}\tuuid=${c.uuid}\tprops=${c.props.join(',')}`);
        }
        break;
      case 'read':
        await doRead(parseInt(rest[0], 10));
        break;
      case 'w':
      case 'wnr': {
        const handle = parseInt(rest[0], 10);
        const bytes = parseHex(rest.slice(1).join(' '));
        await doWrite(handle, bytes, cmd === 'w');
        break;
      }
      case 'cmd': {
        const handle = parseInt(rest[0], 10);
        const name = rest[1];
        const arg = rest[2] !== undefined ? parseInt(rest[2], 10) : undefined;
        const value = Commands[name];
        if (value === undefined) {
          console.log(`Unknown command name: ${name}`);
          break;
        }
        const bytes = typeof value === 'function' ? value(arg) : value;
        await doWrite(handle, bytes, true);
        break;
      }
      case 'notify':
        await doNotifySubscribe(parseInt(rest[0], 10));
        break;
      case 'quit':
      case 'exit':
        await connection.disconnectBluetoothDeviceService(address);
        connection.disconnect();
        process.exit(0);
        break;
      default:
        console.log(`Unknown command: ${cmd}. Type "help" for a list.`);
    }
  } catch (err) {
    console.error('Error handling command:', err.message || err);
  }
  rl.prompt();
};

const onAdvertisement = async (advertisement) => {
  let { address: addr, name, addressType: at } = advertisement;
  const mac = addr.toString(16);
  name = name ? name.replace(/\0/g, '') : name;
  if (mac !== searchMac && !(name && searchName && name.startsWith(searchName))) return;

  connection.removeListener('message.BluetoothLEAdvertisementResponse', onAdvertisement);
  address = addr;
  addressType = at;
  console.log(`Found ${name} (${mac}), Connecting...`);

  let retriesLeft = 5;
  while (true) {
    try {
      const connectResponse = await connection.connectBluetoothDeviceService(address, addressType);
      if (!connectResponse.connected) return console.log('Failed to connect', mac);
      break;
    } catch (err) {
      retriesLeft--;
      if (retriesLeft <= 0) {
        console.error(`Failed to connect ${name} (${mac}), aborting`, err);
        return;
      }
      console.log(`Failed to connect ${name} (${mac}), retrying...`);
    }
  }

  if (pair) {
    console.log('Pairing...');
    const pairResponse = await connection.pairBluetoothDeviceService(address);
    if (!pairResponse.paired) return console.log('Failed to pair', mac);
  }

  console.log('Connected. Listing GATT services...');
  const servicesResponse = await connection.listBluetoothGATTServicesService(address);
  characteristics = [];
  for (const service of servicesResponse.servicesList) {
    for (const characteristic of service.characteristicsList) {
      const props = propNames(characteristic.properties);
      characteristics.push({ handle: characteristic.handle, uuid: characteristic.uuid, props });
    }
  }

  console.log(`Found ${characteristics.length} characteristics. Subscribing to notify-capable ones...`);
  for (const c of characteristics) {
    if ((c.props.includes('NOTIFY') || c.props.includes('INDICATE')) && !PROTECTED_HANDLES.has(c.handle)) {
      try {
        await doNotifySubscribe(c.handle);
      } catch (err) {
        console.error(`Failed to subscribe handle ${c.handle}:`, err.message || err);
      }
    }
  }

  printHelp();
  rl.prompt();
};

connection.on('message.BluetoothLEAdvertisementResponse', onAdvertisement);
connection.on('error', console.error);
connection.once('authorized', () => {
  console.log('Connected to proxy, scanning for target device...');
  connection.subscribeBluetoothAdvertisementService();
});

rl.on('line', (line) => void handleLine(line));
console.log('Connecting to ESPHome proxy...');
connection.connect();
