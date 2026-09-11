// Parses an Android `btsnoop_hci.log` file (captured via Developer options -> enable
// "Bluetooth HCI snoop log", then Developer options -> "Bug report" / "Take bug
// report" - the log is bundled at FS/data/misc/bluetooth/logs/btsnoop_hci.log inside
// the resulting zip) and prints the ATT-layer Write Request/Command and Handle Value
// Notification/Indication traffic for one target BLE device, by address.
//
// This is what actually cracked the Reverie RevCB protocol: GATT dumps and blind
// command-byte guessing got nowhere, but capturing real traffic from the official
// Reverie Nightstand app while manually operating the bed (one action at a time, a
// few seconds apart, so timestamps line up with what you did) showed exactly which
// characteristic handle received which byte for each preset/motor/light action.
//
// Usage:
//   node parse-btsnoop.js <path-to-btsnoop_hci.log> [target-mac-no-colons]
//   (target mac defaults to this project's bed, d63aec0f994a - override for anyone else's)
//
// Gotcha this script specifically guards against: Android reuses BLE connection-handle
// numbers across unrelated devices once a connection drops. An earlier version of this
// script tracked "ever seen this handle for our target" as a one-way set and produced
// garbage output after the real device disconnected and some other accessory (e.g.
// earbuds) was later assigned the same handle number. This version removes a handle
// from the active set on Disconnection Complete, so only traffic within an actual
// connected session for the target address is reported.
import { readFileSync } from 'fs';

const path = process.argv[2];
if (!path) throw new Error('Usage: node parse-btsnoop.js <path-to-btsnoop_hci.log> [target-mac-no-colons]');
const targetAddrDisplay = (process.argv[3] || 'd63aec0f994a').toLowerCase();
// HCI transmits BT addresses little-endian (LSB first) relative to display order.
const targetAddrBytesLE = Buffer.from(targetAddrDisplay.match(/../g).reverse().join(''), 'hex');

const buf = readFileSync(path);
if (buf.toString('ascii', 0, 8) !== 'btsnoop\0') throw new Error('Not a btsnoop file');
const datalink = buf.readUInt32BE(12);
console.log(`btsnoop version=${buf.readUInt32BE(8)} datalink=${datalink}`);

let offset = 16;
const records = [];
while (offset + 24 <= buf.length) {
  const origLen = buf.readUInt32BE(offset);
  const incLen = buf.readUInt32BE(offset + 4);
  const flags = buf.readUInt32BE(offset + 8);
  const ts = buf.readBigUInt64BE(offset + 16);
  offset += 24;
  const data = buf.subarray(offset, offset + incLen);
  offset += incLen;
  records.push({ origLen, incLen, flags, ts, data });
}
console.log(`Parsed ${records.length} HCI records`);

const t0 = records.length ? records[0].ts : 0n;
const relSec = (ts) => Number(ts - t0) / 1e6;

// Connection handles currently believed to belong to the target address. A handle is
// added on a successful LE Connection Complete for the target address, and removed
// again on that handle's Disconnection Complete - since Android/BlueZ can and will
// reuse the same numeric handle for a completely different peer afterwards.
const targetHandles = new Set();

// Per-ACL-handle L2CAP reassembly buffers
const reassembly = new Map(); // aclHandle -> { l2capLen, cid, buf, ts, direction }

const attOpcodeNames = {
  0x01: 'ErrorResponse',
  0x02: 'ExchangeMTURequest',
  0x03: 'ExchangeMTUResponse',
  0x04: 'FindInformationRequest',
  0x05: 'FindInformationResponse',
  0x08: 'ReadByTypeRequest',
  0x09: 'ReadByTypeResponse',
  0x0a: 'ReadRequest',
  0x0b: 'ReadResponse',
  0x0c: 'ReadBlobRequest',
  0x0d: 'ReadBlobResponse',
  0x10: 'ReadByGroupTypeRequest',
  0x11: 'ReadByGroupTypeResponse',
  0x12: 'WriteRequest',
  0x13: 'WriteResponse',
  0x16: 'PrepareWriteRequest',
  0x17: 'PrepareWriteResponse',
  0x18: 'ExecuteWriteRequest',
  0x19: 'ExecuteWriteResponse',
  0x1b: 'HandleValueNotification',
  0x1d: 'HandleValueIndication',
  0x1e: 'HandleValueConfirmation',
  0x52: 'WriteCommand',
  0xd2: 'SignedWriteCommand',
};

const events = [];

const toHex = (b) => Buffer.from(b).toString('hex').replace(/(..)/g, '$1 ').trim();

const handleAttPdu = (aclHandle, direction, ts, att) => {
  if (att.length === 0) return;
  const opcode = att[0];
  const name = attOpcodeNames[opcode] || `Unknown(0x${opcode.toString(16)})`;
  if (opcode === 0x12 || opcode === 0x52 || opcode === 0x1b || opcode === 0x1d) {
    const attrHandle = att.readUInt16LE(1);
    const value = att.subarray(3);
    events.push({ t: relSec(ts), aclHandle, direction, opcode: name, attrHandle, value: toHex(value) });
  } else if (opcode === 0x0b || opcode === 0x01) {
    events.push({ t: relSec(ts), aclHandle, direction, opcode: name, value: toHex(att.subarray(1)) });
  }
};

for (const rec of records) {
  const data = rec.data;
  if (data.length === 0) continue;
  const h4type = data[0];
  const direction = rec.flags & 1 ? 'RX' : 'TX'; // RX = controller->host, TX = host->controller

  if (h4type === 0x04) {
    // HCI Event
    const eventCode = data[1];
    const paramLen = data[2];
    const params = data.subarray(3, 3 + paramLen);
    if (eventCode === 0x3e) {
      // LE Meta Event
      const subevent = params[0];
      if (subevent === 0x01 || subevent === 0x0a) {
        // LE Connection Complete (0x01) / LE Enhanced Connection Complete (0x0a)
        // status(1) handle(2 LE) role(1) peerAddrType(1) peerAddr(6)
        const status = params[1];
        if (status === 0) {
          const connHandle = params.readUInt16LE(2);
          const peerAddr = params.subarray(6, 12);
          if (Buffer.compare(peerAddr, targetAddrBytesLE) === 0) {
            targetHandles.add(connHandle);
            console.log(
              `[${relSec(rec.ts).toFixed(3)}s] Connection established: handle=${connHandle} addr=${toHex(peerAddr)} <- TARGET`
            );
          }
        }
      }
    } else if (eventCode === 0x05) {
      // Disconnection Complete: status(1) handle(2 LE) reason(1)
      const status = params[0];
      if (status === 0) {
        const connHandle = params.readUInt16LE(1);
        if (targetHandles.has(connHandle)) {
          console.log(`[${relSec(rec.ts).toFixed(3)}s] Disconnected: handle=${connHandle}`);
          // Important: stop treating this handle number as ours - it can and will be
          // reassigned to an unrelated device later in the same capture.
          targetHandles.delete(connHandle);
          reassembly.delete(connHandle);
        }
      }
    }
  } else if (h4type === 0x02) {
    // ACL Data: handle+flags(2 LE), dataLen(2 LE), payload
    const handleAndFlags = data.readUInt16LE(1);
    const aclHandle = handleAndFlags & 0x0fff;
    const pb = (handleAndFlags >> 12) & 0x3;
    const dataLen = data.readUInt16LE(3);
    const payload = data.subarray(5, 5 + dataLen);

    if (!targetHandles.has(aclHandle)) continue;

    if (pb === 0 || pb === 2) {
      // first fragment: L2CAP header
      const l2capLen = payload.readUInt16LE(0);
      const cid = payload.readUInt16LE(2);
      const body = payload.subarray(4);
      if (body.length >= l2capLen) {
        if (cid === 0x0004) handleAttPdu(aclHandle, direction, rec.ts, body.subarray(0, l2capLen));
      } else {
        reassembly.set(aclHandle, { l2capLen, cid, buf: Buffer.from(body), ts: rec.ts, direction });
      }
    } else if (pb === 1) {
      // continuing fragment
      const r = reassembly.get(aclHandle);
      if (!r) continue;
      r.buf = Buffer.concat([r.buf, payload]);
      if (r.buf.length >= r.l2capLen) {
        if (r.cid === 0x0004) handleAttPdu(aclHandle, r.direction, r.ts, r.buf.subarray(0, r.l2capLen));
        reassembly.delete(aclHandle);
      }
    }
  }
}

console.log(`\n=== ATT traffic on target device (${events.length} events) ===`);
for (const e of events) {
  console.log(
    `[${e.t.toFixed(3)}s] ${e.direction} ${e.opcode}${e.attrHandle !== undefined ? ` handle=${e.attrHandle}` : ''} value=${e.value}`
  );
}
