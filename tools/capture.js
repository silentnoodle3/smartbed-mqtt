// Connects to an ESPHome Bluetooth proxy, finds a target BLE device by name/MAC,
// connects to it, dumps its full GATT services/characteristics tree (with any
// readable values) to a JSON file. This is the tool that produced the original
// GATT dumps used to start reverse engineering the Reverie RevCB protocol.
//
// Usage:
//   BLE_HOST=<esphome-proxy-host> BLE_TARGET=<device-name-or-name-prefix> node capture.js
//   BLE_HOST=<esphome-proxy-host> BLE_TARGET=<mac-hex-no-colons> node capture.js
//   BLE_MODE=PAIR ...                (pair with the device before reading characteristics)
//   LOG_LEVEL=debug ...              (log every advertisement seen, not just matches)
//
// Writes <sanitized-device-name>.json to the current directory.
import { Connection } from '@2colors/esphome-native-api';
import { promises as fs } from 'fs';

const { BLE_HOST, BLE_TARGET, BLE_MODE, LOG_LEVEL } = process.env;
if (!BLE_HOST) throw Error('Please specify the BLE_HOST');
if (!BLE_TARGET) throw Error('Please specify a BLE_TARGET');

const pair = BLE_MODE === 'PAIR';
const debugLogging = LOG_LEVEL?.toLowerCase() === 'debug';
const [searchName, searchMac] = BLE_TARGET.split('::').map((x, i) => (i === 0 ? x : x.toLowerCase()));
const connection = new Connection({ host: BLE_HOST });
const list = {};
connection.once('authorized', async () => {
  console.log('Connected, Scanning...');
  connection.subscribeBluetoothAdvertisementService();
});

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
const buildPropertiesList = (properties) => {
  const propertiesList = [properties];

  for (const [name, value] of Object.entries(characteristicPropertyValues)) {
    if ((properties & value) === value) {
      properties -= value;
      propertiesList.push(name);
      if (properties === 0) break;
    }
  }
  return propertiesList;
};

const onAdvertisement = async (advertisement) => {
  let { address, name, addressType } = advertisement;
  const mac = address.toString(16);
  if (debugLogging) console.log(`Advertisement: ${name} (${mac})`);
  name = name ? name.replace(/\0/g, '') : name;
  if (mac !== searchMac && !(name && searchName && name.startsWith(searchName))) return;

  if (list[address]) return;
  console.log(`Found ${name} (${mac}), Connecting...`);
  const data = (list[address] = { mac, ...advertisement, name });
  console.log(JSON.stringify(advertisement, null, 2));
  let retriesLeft = 5;
  while (true) {
    try {
      const connectResponse = await connection.connectBluetoothDeviceService(address, addressType);
      if (!connectResponse.connected) return console.log('Failed to connect', mac);
      break;
    } catch (err) {
      retriesLeft--;
      if (retriesLeft > 0) {
        console.log(`Failed to connect ${name} (${mac}), retrying...`);
      } else {
        console.log(`Failed to connect ${name} (${mac}), aborting`);
        console.error(err);
        return;
      }
    }
  }
  if (pair) {
    console.log(`Connected to ${name} successfully, pairing...`);

    const pairResponse = await connection.pairBluetoothDeviceService(address);
    if (!pairResponse.paired) return console.log('Failed to pair', mac);
  }

  try {
    console.log(`${pair ? 'Paired' : 'Connected'} with ${name} successfully, Listing services...`);
    const servicesResponse = await connection.listBluetoothGATTServicesService(address);
    for (const service of servicesResponse.servicesList)
      for (const characteristic of service.characteristicsList) {
        const { properties, handle } = characteristic;
        characteristic.properties = buildPropertiesList(properties);
        if ((properties & 2) === 2) {
          try {
            const readResponse = await connection.readBluetoothGATTCharacteristicService(address, handle);
            const buffer = Buffer.from(readResponse.data, 'base64');
            characteristic.data = {
              base64: readResponse.data,
              ascii: buffer.toString(),
              raw: Array.from(new Uint8Array(buffer)),
            };
          } catch {
            characteristic.data = 'Read Error';
            console.error(`Couldn't read characteristic 0x${handle.toString(16)}`);
          }
        }
      }

    data.servicesList = servicesResponse.servicesList;
    name = name
      .replace(/[^0-9A-Z]/gi, ' ')
      .trimEnd()
      .replace(/\s+/g, '_');
    await fs.writeFile(`${name}.json`, JSON.stringify(data, null, 2));
    console.log(`Exported config: ${name}.json`);
  } catch (err) {
    console.error(err);
  }
  await connection.disconnectBluetoothDeviceService(address);
  connection.disconnect();
  process.exit(0);
};
connection.on('message.BluetoothLEAdvertisementResponse', onAdvertisement);
connection.on('error', console.error);
console.log('Connecting...');
connection.connect();
