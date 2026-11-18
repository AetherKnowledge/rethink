import { describe, test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/WIN_056905_WW'
import Bridge from '@/cloud/ha_bridge'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'
import { decodePacket, encodePacket } from '@/util/packet-codec'
import * as TLV from '@/util/tlv'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'WIN_056905_WW'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '353700' }

// Real LA130GC packets captured 2026-11-18, firmware 353700, EEPROM 0x0522.
// Commands and replies were verified live; synthetic variants below are labeled.
const SAMPLE_CAPABILITIES = buf(
    '000004000000A70201E955B009B047B09054B0C1B101B300B340B4E05016B55060B6A00522B6F0353700B85020B8903CB8D020B9103CBC600201BD30080000B5A08000D3E00400DD04BD47FA01B5C0B61038B646B5C1B600B646B5C2B600B646BA69',
)
const SAMPLE_INITIAL = buf(
    '000004000000A70204454A7E407DC17E867F50367F90388180C8C08340868086C08700884089408A008A50568A808CA0012E8CD05EACD032D550F9D590FA87C0E800CAD081CB10A4CB8CCBC0CC00CC909C1B00C0C04331',
)
const SAMPLE_COOLING = buf(
    '000004000000A70204B34B7E407DC17E867F50347F90308180C8C08340868086C08700884089408A102B8A50558A8F8C90498CD061ACE00337D550F9D590FA87C0E800CAD05ACB10C8CB8CCBCFCC00CC90A11B01C0C0E9F8',
)
const SAMPLE_DRY = buf(
    '000004000000A70204D04B7E417DC17E867F50347F90308180C8C08340868086C08700884089408A102B8A50548A8F8C90518CD01CACE00337D550F9D590FA87C0E800CAD05ACB10C8CB8CCBCFCC00CC90A11B01C0C0EB53',
)
const SAMPLE_FAN = buf(
    '000004000000A70204534B7E427DC17E867F50337F90328180C8C08340868086C08700884089408A10258A50558A808C907D8CD01EACE002CBD550F9D590FA87C0E800CAD059CB10C9CB8CCBC0CC00CC90A41B00C0C03894',
)
const SAMPLE_OFF = buf(
    '000004000000A7020485477E427DC07E867F50347F90328180C8C08340868086C08700884089408A008A50548A808C808CC0ACD032D550F9D590FA87C0E800CAD075CB10B7CB8CCBC0CC00CC90A21B00C0C0A85D',
)

// Native reset reads remaining hours but writes elapsed hours; RAC private record is separate.
const SAMPLE_FILTER_RESET_ACK = buf('02FF0400000087FD100005FE020000002C12')
const SAMPLE_FILTER_PRIVATE_BEFORE = buf('02FF0400000087FD03010D0200000000D0020000000000003920')
const SAMPLE_FILTER_PRIVATE_AFTER = buf('02FF0400000087FD03010D0200000000D0020000FE283501C111')
const SAMPLE_FILTER_PRIVATE_RESTORED = buf('02FF0400000087FD03010D0200000000D0020000000000003920')
const SAMPLE_FILTER_NATIVE_WRITE_MAX_BEFORE = buf(
    '000004000000A7020497477E407DC07E867F50317F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD087CB10A1CB8CCBC0CC00CC909B1B00C0C0F913',
)
const SAMPLE_FILTER_NATIVE_WRITE_MAX_NOTIFICATION = buf('000004000000A702049805D540AC5012375A')
const SAMPLE_FILTER_NATIVE_WRITE_MAX_AFTER = buf(
    '000004000000A7020499467E407DC07E867F50317F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D540D590FA87C0E800CAD087CB10A1CB8CCBC0CC00CC909B1B00C0C01FB2',
)
const SAMPLE_FILTER_NATIVE_RESET_COMMAND = buf('0101040000006502010102D5400029')
const SAMPLE_FILTER_HANDLER_RESET_COMMAND = buf('0101040000006502010102D5400029')
const SAMPLE_FILTER_NATIVE_RESET_NOTIFICATION = buf('000004000000A70204A805D550FAAC40B505')
const SAMPLE_FILTER_NATIVE_RESET_AFTER = buf(
    '000004000000A70204A9477E407DC07E867F50317F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550FAD590FA87C0E800CAD088CB10A1CB8CCBC0CC00CC909B1B00C0C03A7F',
)
const SAMPLE_FILTER_HANDLER_RESET_AFTER = buf(
    '000004000000A70204B7477E407DC07E867F50317F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550FAD590FA87C0E800CAD088CB10A1CB8CCBC0CC00CC909B1B00C0C0B050',
)
const SAMPLE_FILTER_NATIVE_BEFORE = buf(
    '000004000000A702042F477E407DC07E867F502F7F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD080CB10A1CB8CCBC0CC00CC909B1B00C0C01F8F',
)
const SAMPLE_FILTER_NATIVE_AFTER = buf(
    '000004000000A7020431477E407DC07E867F502F7F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD080CB10A1CB8CCBC0CC00CC909B1B00C0C095A0',
)
const SAMPLE_FILTER_RESTORE_ACK = buf('02FF0400000087FD100005FE020000002C12')
const SAMPLE_FILTER_NATIVE_RESTORED = buf(
    '000004000000A7020464477E407DC07E867F502F7F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD083CB10A1CB8CCBC0CC00CC909B1B00C0C0EF2F',
)

function makeDevice(t: TestContext) {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    ha.on('setProperty', (_id: string, prop: string, value: string) => dev.setProperty(prop, value))
    t.after(() => dev.drop())
    return { ha, thinq, dev }
}

function ready(t: TestContext) {
    const result = makeDevice(t)
    result.thinq.emit('data', SAMPLE_CAPABILITIES)
    result.thinq.emit('data', SAMPLE_INITIAL)
    result.thinq.resetRecorder()
    return result
}

function sent(thinq: MockThinq2Device) {
    assert.equal(thinq.outbox.length, 1, 'one atomic command')
    const decoded = decodePacket(hex(thinq.outbox[0]))
    assert.equal(decoded.protocol, 'tlv')
    if (decoded.protocol !== 'tlv') throw new Error('Expected TLV')
    assert.ok(decoded.crcOk)
    return decoded.tlv.map(({ t, v }) => ({ t, v }))
}

// Explicitly synthetic frames for missing-capability, malformed-input and legacy compatibility tests.
function synthetic(tlv: TLV.TLV[]) {
    return encodePacket({ protocol: 'tlv', direction: 'fromDevice', tlv }).buffer
}

function tlvs(packet: Buffer) {
    return TLV.parse(packet.subarray(11, -2))
}

describe(MODEL_ID, () => {
    test('WIN ThinQ registration selects the handler without depending on physical model metadata', (t) => {
        const ha = new MockHAConnection()
        const thinq = new MockThinq2Device(DEVICE_ID, META)
        const bridge = new Bridge(ha.asConnection())
        bridge.newDevice(thinq)
        t.after(() => bridge.dropDevice(bridge.haDevices.get(DEVICE_ID)!))
        assert.ok(bridge.haDevices.get(DEVICE_ID) instanceof DUT)
        assert.ok(thinq.managed)
        thinq.emit('data', SAMPLE_CAPABILITIES)
        thinq.emit('data', SAMPLE_INITIAL)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'cool')
    })

    test('waits for capabilities and complete command attachments before discovery', (t) => {
        const { ha, thinq, dev } = makeDevice(t)
        assert.equal(ha.devices[DEVICE_ID]?.config, undefined)
        dev.setProperty('climate-temperature', '24')
        assert.equal(thinq.outbox.length, 1, 'only constructor capability query')
        thinq.emit('data', SAMPLE_CAPABILITIES)
        assert.equal(ha.devices[DEVICE_ID]?.config, undefined)
        // Synthetic full-size response with target temperature missing.
        thinq.emit('data', synthetic(tlvs(SAMPLE_INITIAL).filter(({ t }) => t !== 0x1fe)))
        assert.equal(ha.devices[DEVICE_ID]?.config, undefined)
        thinq.emit('data', synthetic([{ t: 0x1fe, v: 56 }]))
        assert.equal(ha.devices[DEVICE_ID].availability, 'online')
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'current_temperature'), 27)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'temperature_state'), 28)
    })

    test('LA130GC discovery follows captured capabilities and the MQTT device discovery contract', (t) => {
        const { ha, dev } = ready(t)
        const config = ha.devices[DEVICE_ID].config!
        assert.equal('name' in config, false, 'device name cannot be a discovery root option')
        assert.equal(config.device.name, 'LG Air Conditioner')
        assert.equal(config.device.identifiers, '$deviceid')
        assert.equal(config.origin.name, 'rethink')
        assert.deepEqual(config.availability, [{ topic: '$this/availability' }, { topic: '$rethink/availability' }])
        assert.equal(config.availability_mode, 'all')
        const climate = config.components.climate as Record<string, unknown>
        assert.deepEqual(climate.modes, ['off', 'cool', 'dry', 'fan_only'])
        assert.deepEqual(climate.fan_modes, ['low', 'medium', 'high'])
        assert.equal(climate.swing_modes, undefined)
        assert.equal(climate.swing_mode_command_topic, undefined)
        assert.equal(climate.min_temp, 16)
        assert.equal(climate.max_temp, 30)
        assert.equal(climate.temp_step, 1)
        assert.equal(climate.precision, 0.5, 'room temperature still reports half degrees')
        assert.equal(climate.unique_id, '$deviceid-climate', 'existing entity identity remains stable')
        assert.equal(climate.mode_command_topic, '$this/climate-mode/set')
        assert.equal(climate.mode_state_topic, '$this/climate-mode')
        dev.drop()
        assert.equal(ha.devices[DEVICE_ID].availability, 'offline')
    })

    test('captured fan writes and their actual replies round trip all three speeds', (t) => {
        const { ha, thinq } = ready(t)
        for (const [label, command, response] of [
            [
                'low',
                '01010400000065020101077E827E407F9038D0EC',
                '000004000000A7020400477E407DC17E827F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F9D590FA87C0E800CAD089CB109BCB8CCBC0CC00CC90991B00C0C09B7C',
            ],
            [
                'medium',
                '01010400000065020101077E847E407F90385D0D',
                '000004000000A702041F477E407DC17E847F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F9D590FA87C0E800CAD08ACB109ACB8CCBC0CC00CC909A1B00C0C08A85',
            ],
            [
                'high',
                '01010400000065020101077E867E407F9038D64D',
                '000004000000A7020427477E407DC17E867F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F9D590FA87C0E800CAD08ACB109ACB8CCBC0CC00CC909A1B00C0C02706',
            ],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'climate', 'fan_mode_command', label)
            assert.equal(hex(thinq.outbox[0]), command)
            thinq.emit('data', buf(response))
            assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'fan_mode_state'), label)
        }
    })

    test('captured temperature writes and actual replies verify scaling and 16 C minimum', (t) => {
        const { ha, thinq } = ready(t)
        for (const [value, command, response] of [
            [
                56,
                '01010400000065020101077F90387E407E86372B',
                '000004000000A702042E477E407DC17E867F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F9D590FA87C0E800CAD08ACB109ACB8CCBC0CC00CC909A1B00C0C0C2A2',
            ],
            [
                52,
                '01010400000065020101077F90347E407E86BC00',
                '000004000000A7020435477E407DC17E867F50397F90348180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F9D590FA87C0E800CAD08ACB109ACB8CCBC0CC00CC909A1B00C0C0BBCC',
            ],
            [
                48,
                '01010400000065020101077F90307E407E863506',
                '000004000000A702043E477E407DC17E867F50397F90308180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F9D590FA87C0E800CAD08ACB109ACB8CCBC0CC00CC909A1B00C0C08B77',
            ],
            [
                32,
                '01010400000065020101077F90207E407E86315C',
                '000004000000A70204D54B7E407DC17E867F50367F90208180C8C08340868086C08700884089408A101F8A50558A8F8C90148CD028ACE00260D550F9D590FA87C0E800CAD066CB10C1CB8CCBCFCC00CC909D1B01C0C006BC',
            ],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'climate', 'temperature_command', String(value / 2))
            assert.equal(hex(thinq.outbox[0]), command)
            thinq.emit('data', buf(response))
            assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'temperature_state'), value / 2)
        }
    })

    test('whole-degree setpoints avoid the half-degree write rejected by the appliance', (t) => {
        const { ha, thinq } = ready(t)
        // Captured 24.5 C request was rejected: returned target remained 24 C.
        const rejected = buf(
            '000004000000A702046D4A7E407DC17E867F50397F90308180C8C08340868086C08700884089408A10238A50548A8F8C818CD03EACE00189D550F9D590FA87C0E800CAD07ECB10B2CB8CCBCFCC00CC909A1B01C0C08241',
        )
        thinq.emit('data', rejected)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'temperature_state'), 24)
        ha.setProperty(DEVICE_ID, 'climate', 'temperature_command', '24.5')
        assert.equal(sent(thinq)[0].v, 50, 'round to supported 25 C rather than sending rejected 24.5 C')
        for (const [input, expected] of [
            ['-20', 32],
            ['40', 60],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'climate', 'temperature_command', input)
            assert.equal(sent(thinq)[0].v, expected)
        }
    })

    test('unsupported commands have no power-on side effects or malformed numeric writes', (t) => {
        const { thinq, dev } = ready(t)
        dev.processKeyValue(0x1f7, 0)
        for (const [prop, values] of [
            ['mode', ['heat', 'auto', 'invalid']],
            ['fan_mode', ['auto', 'very high', 'invalid']],
            ['temperature', ['', ' ', 'NaN', 'Infinity', '24x']],
            ['power', ['invalid']],
        ] as const) {
            for (const value of values) dev.setProperty(`climate-${prop}`, value)
        }
        assert.equal(thinq.outbox.length, 0)
        assert.equal(dev.raw_clip_state[0x1f7], 0)
    })

    test('mode off sends only power off; supported modes start atomically with complete state', (t) => {
        const { ha, thinq, dev } = ready(t)
        ha.setProperty(DEVICE_ID, 'climate', 'mode_command', 'off')
        assert.deepEqual(sent(thinq), [{ t: 0x1f7, v: 0 }])
        for (const [mode, value] of [
            ['cool', 0],
            ['dry', 1],
            ['fan_only', 2],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'climate', 'mode_command', mode)
            assert.deepEqual(sent(thinq), [
                { t: 0x1f9, v: value },
                { t: 0x1f7, v: 1 },
                { t: 0x1fa, v: 6 },
                { t: 0x1fe, v: 56 },
            ])
            // Synthetic notification checks either TLV ordering, including power-only updates.
            dev.processTLV([{ t: 0x1f7, v: 0 }])
            assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'off')
            dev.processTLV([
                { t: 0x1f9, v: value },
                { t: 0x1f7, v: 1 },
            ])
            assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), mode)
        }
    })

    test('legacy heating, two-speed fan, half-degree steps and swing remain available', (t) => {
        const { ha, thinq } = makeDevice(t)
        // Synthetic legacy capabilities; no captured LW1823HRSM packets are available.
        thinq.emit('data', synthetic([{ t: 0x2da, v: 1 }]))
        thinq.emit('data', synthetic([...tlvs(SAMPLE_INITIAL), { t: 0x322, v: 100 }]))
        const climate = ha.devices[DEVICE_ID].config!.components.climate as Record<string, unknown>
        assert.deepEqual(climate.modes, ['off', 'cool', 'fan_only', 'heat'])
        assert.deepEqual(climate.fan_modes, ['low', 'high'])
        assert.equal(climate.temp_step, 0.5)
        assert.deepEqual(climate.swing_modes, ['on', 'off'])
        thinq.resetRecorder()
        ha.setProperty(DEVICE_ID, 'climate', 'mode_command', 'heat')
        assert.equal(sent(thinq)[0].v, 4)
        thinq.emit('data', synthetic([{ t: 0x1f9, v: 4 }]))
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'heat')
    })

    test('explicit heating capabilities preserve heat and constrain fan and swing controls', (t) => {
        const { ha, thinq } = makeDevice(t)
        // Synthetic alternate physical model with the same ThinQ identifier.
        thinq.emit(
            'data',
            synthetic([
                { t: 0x2da, v: 2 },
                { t: 0x2c1, v: 0x15 },
                { t: 0x2c2, v: 0x44 },
                { t: 0x2cd, v: 8 },
            ]),
        )
        thinq.emit('data', synthetic([...tlvs(SAMPLE_INITIAL), { t: 0x322, v: 0 }]))
        const climate = ha.devices[DEVICE_ID].config!.components.climate as Record<string, unknown>
        assert.deepEqual(climate.modes, ['off', 'cool', 'fan_only', 'heat'])
        assert.deepEqual(climate.fan_modes, ['low', 'high'])
        assert.deepEqual(climate.swing_modes, ['on', 'off'])
    })

    test('missing legacy swing capabilities do not advertise an unreported swing field', (t) => {
        const { ha, thinq } = makeDevice(t)
        // Synthetic legacy caps omit 0x2cd; the captured LA130GC state also lacks 0x322.
        thinq.emit('data', synthetic([{ t: 0x2da, v: 1 }]))
        thinq.emit('data', SAMPLE_INITIAL)
        const climate = ha.devices[DEVICE_ID].config!.components.climate as Record<string, unknown>
        assert.equal(climate.swing_modes, undefined)
        assert.equal(climate.swing_mode_command_topic, undefined)
    })

    test('truncated and unrelated frames do not initialize or mutate command state', (t) => {
        const { ha, thinq, dev } = makeDevice(t)
        thinq.emit('data', SAMPLE_CAPABILITIES)
        const before = { ...dev.raw_clip_state }
        thinq.emit('data', SAMPLE_INITIAL.subarray(0, -3))
        thinq.emit('data', buf('00112233445566778899'))
        assert.deepEqual(dev.raw_clip_state, before)
        assert.equal(ha.devices[DEVICE_ID]?.config, undefined)
    })

    test('unverified energy fields stay raw protocol state rather than becoming fabricated kWh', (t) => {
        const { ha, dev } = ready(t)
        assert.equal(dev.raw_clip_state[0x232], 302)
        assert.equal(dev.raw_clip_state[0x233], 94)
        for (const component of Object.values(ha.devices[DEVICE_ID].config!.components)) {
            assert.notEqual((component as Record<string, unknown>).device_class, 'energy')
        }
    })

    test('power updates preserve the cloud watts and the reported standby floor', (t) => {
        const { ha, thinq } = ready(t)
        assert.equal(ha.getProperty(DEVICE_ID, 'energy_current', 'state'), 50)
        const power = ha.devices[DEVICE_ID].config!.components.energy_current as Record<string, unknown>
        assert.equal(power.device_class, 'power')
        assert.equal(power.state_class, 'measurement')
        assert.equal(power.unit_of_measurement, 'W')
        assert.equal(power.command_topic, undefined)
        thinq.emit('data', SAMPLE_COOLING)
        assert.equal(ha.getProperty(DEVICE_ID, 'energy_current', 'state'), 823)
        thinq.emit('data', SAMPLE_OFF)
        assert.equal(ha.getProperty(DEVICE_ID, 'energy_current', 'state'), 50)
    })

    test('captured energy-control and mute commands round trip with capability and mode guards', (t) => {
        const { ha, thinq, dev } = ready(t)
        for (const [option, command, response] of [
            [
                '80%',
                '0101040000006502010103835050EA5C',
                '000004000000A70204E44C7E407DC17E867F50367F90308180C8C0835050868086C08700884089408A101F8A50558A8F8C90148CD028ACE00260D550F9D590FA87C0E800CAD066CB10C1CB8CCBCFCC00CC909D1B01C0C0350E',
            ],
            [
                '60%',
                '010104000000650201010383503C4776',
                '000004000000A70204464B7E407DC17E867F50357F90308180C8C083503C868086C08700884089408A10208A50558A8F8C90278CCFACE00274D550F9D590FA87C0E800CAD064CB10C3CB8CCBCFCC00CC909F1B01C0C051AC',
            ],
            [
                '40%',
                '010104000000650201010383502815C3',
                '000004000000A70204914C7E407DC17E867F50347F90308180C8C0835028868086C08700884089408A102B8A50548A8F8C90428CD042ACE0036DD550F9D590FA87C0E800CAD05ACB10C9CB8CCBCFCC00CC90A11B01C0C03AF9',
            ],
            [
                'off',
                '01010400000065020101028340A430',
                '000004000000A702049D4B7E407DC17E867F50347F90308180C8C08340868086C08700884089408A102B8A50558A8F8C90428CD042ACE0036DD550F9D590FA87C0E800CAD05BCB10C8CB8CCBCFCC00CC90A11B01C0C0147F',
            ],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'energylimit', 'command', option)
            assert.equal(hex(thinq.outbox[0]), command)
            thinq.emit('data', buf(response))
            assert.equal(ha.getProperty(DEVICE_ID, 'energylimit', 'state'), option)
        }
        for (const [option, command, response] of [
            [
                'OFF',
                '0101040000006502010102E8012B05',
                '000004000000A70204A84B7E407DC17E867F50347F90308180C8C08340868086C08700884089408A102B8A50558A8F8C90428CD042ACE0036DD550F9D590FA87C0E801CAD05BCB10C8CB8CCBCFCC00CC90A11B01C0C046F7',
            ],
            [
                'ON',
                '0101040000006502010102E8003B24',
                '000004000000A70204B34B7E407DC17E867F50347F90308180C8C08340868086C08700884089408A102B8A50558A8F8C90498CD061ACE00337D550F9D590FA87C0E800CAD05ACB10C8CB8CCBCFCC00CC90A11B01C0C0E9F8',
            ],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'beep', 'command', option)
            assert.equal(hex(thinq.outbox[0]), command)
            thinq.emit('data', buf(response))
            assert.equal(ha.getProperty(DEVICE_ID, 'beep', 'state'), option)
        }
        thinq.resetRecorder()
        dev.processTLV([{ t: 0x1f9, v: 2 }])
        assert.equal(ha.devices[DEVICE_ID].properties['energylimit/availability'], 'offline')
        ha.setProperty(DEVICE_ID, 'energylimit', 'command', '80%')
        ha.setProperty(DEVICE_ID, 'beep', 'command', 'invalid')
        assert.equal(thinq.outbox.length, 0)
        dev.processTLV([{ t: 0x1f9, v: 0 }])
        assert.equal(ha.devices[DEVICE_ID].properties['energylimit/availability'], 'online')
        ha.setProperty(DEVICE_ID, 'energylimit', 'command', 'invalid')
        assert.equal(thinq.outbox.length, 0)
    })

    test('captured running and idle states drive climate action and diagnostics', (t) => {
        const { ha, thinq } = ready(t)
        assert.equal(ha.devices[DEVICE_ID].properties['climate-action'], 'idle')
        assert.equal(ha.getProperty(DEVICE_ID, 'error', 'state'), 0)
        thinq.emit('data', SAMPLE_COOLING)
        assert.equal(ha.devices[DEVICE_ID].properties['climate-action'], 'cooling')
        thinq.emit('data', SAMPLE_DRY)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'dry')
        assert.equal(ha.devices[DEVICE_ID].properties['climate-action'], 'drying')
        thinq.emit('data', SAMPLE_FAN)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'fan_only')
        assert.equal(ha.devices[DEVICE_ID].properties['climate-action'], 'fan')
        thinq.emit('data', SAMPLE_OFF)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'off')
        assert.equal(ha.devices[DEVICE_ID].properties['climate-action'], 'off')
    })

    test('optional entities require advertised capabilities and observed fields', (t) => {
        const { ha, thinq } = makeDevice(t)
        // Synthetic capability-negative variant; values alone do not prove writable features or watts.
        thinq.emit('data', synthetic(tlvs(SAMPLE_CAPABILITIES).filter(({ t }) => ![0x2d5, 0x34f, 0x374].includes(t))))
        thinq.emit('data', SAMPLE_INITIAL)
        const components = ha.devices[DEVICE_ID].config!.components
        assert.equal(components.energy_current, undefined)
        assert.equal(components.energylimit, undefined)
        assert.equal(components.beep, undefined)
    })

    test('window filter fields retain their native remaining-hours semantics', (t) => {
        const { ha, thinq, dev } = ready(t)
        assert.equal(ha.getProperty(DEVICE_ID, 'filterremaining', 'state'), 249)
        assert.equal(ha.getProperty(DEVICE_ID, 'filterlife', 'state'), 250)
        const remaining = ha.devices[DEVICE_ID].config!.components.filterremaining as Record<string, unknown>
        assert.equal(remaining.unit_of_measurement, 'h')
        assert.equal(remaining.device_class, 'duration')
        assert.equal(remaining.command_topic, undefined)
        thinq.resetRecorder()
        dev.setProperty('filterremaining-', '0')
        assert.equal(thinq.outbox.length, 0, 'read-only; no filter reset command')
    })

    test('missing filter lifetime does not create misleading filter sensors', (t) => {
        const { ha, thinq } = makeDevice(t)
        thinq.emit('data', SAMPLE_CAPABILITIES)
        thinq.emit('data', synthetic(tlvs(SAMPLE_INITIAL).filter(({ t }) => t !== 0x356)))
        assert.equal(ha.devices[DEVICE_ID].config!.components.filterremaining, undefined)
        assert.equal(ha.devices[DEVICE_ID].config!.components.filterlife, undefined)
    })

    test('accepted basic filter reset does not replace the native WIN filter reminder', (t) => {
        const { ha, thinq } = ready(t)
        // Actual reset ACK is successful, but the affected record has a different lifetime.
        assert.equal(SAMPLE_FILTER_RESET_ACK[0], 2)
        assert.equal(SAMPLE_FILTER_PRIVATE_BEFORE.readUInt32LE(16), 720)
        assert.equal(SAMPLE_FILTER_PRIVATE_AFTER.readUInt32LE(20), 20261118)
        assert.equal(SAMPLE_FILTER_PRIVATE_RESTORED.readUInt32LE(20), 0)
        for (const packet of [
            SAMPLE_FILTER_NATIVE_BEFORE,
            SAMPLE_FILTER_PRIVATE_BEFORE,
            SAMPLE_FILTER_RESET_ACK,
            SAMPLE_FILTER_PRIVATE_AFTER,
            SAMPLE_FILTER_NATIVE_AFTER,
            SAMPLE_FILTER_RESTORE_ACK,
            SAMPLE_FILTER_PRIVATE_RESTORED,
            SAMPLE_FILTER_NATIVE_RESTORED,
        ]) {
            thinq.emit('data', packet)
            assert.equal(ha.getProperty(DEVICE_ID, 'filterremaining', 'state'), 248)
            assert.equal(ha.getProperty(DEVICE_ID, 'filterlife', 'state'), 250)
        }
        assert.equal(thinq.outbox.length, 0, 'private filter replies do not trigger a reset write')
    })

    test('native filter reset writes zero elapsed hours and waits for reported remaining hours', (t) => {
        const { ha, thinq, dev } = ready(t)
        const remaining = () => ha.getProperty(DEVICE_ID, 'filterremaining', 'state')
        // Captured write of 250 did not reset: firmware reported zero remaining instead.
        thinq.emit('data', SAMPLE_FILTER_NATIVE_WRITE_MAX_BEFORE)
        assert.equal(remaining(), 248)
        thinq.emit('data', SAMPLE_FILTER_NATIVE_WRITE_MAX_NOTIFICATION)
        thinq.emit('data', SAMPLE_FILTER_NATIVE_WRITE_MAX_AFTER)
        assert.equal(remaining(), 0)

        const button = ha.devices[DEVICE_ID].config!.components.filterreset as Record<string, unknown>
        assert.equal(button.command_topic, '$this/filterreset/set')
        for (const value of ['', '0', 'ON', 'press']) dev.setProperty('filterreset', value)
        assert.equal(thinq.outbox.length, 0, 'only the button press resets history')
        ha.setProperty(DEVICE_ID, 'filterreset', 'command', 'PRESS')
        assert.deepEqual(thinq.outbox[0], SAMPLE_FILTER_NATIVE_RESET_COMMAND)
        assert.deepEqual(
            SAMPLE_FILTER_HANDLER_RESET_COMMAND,
            SAMPLE_FILTER_NATIVE_RESET_COMMAND,
            'live handler sent the verified command',
        )
        assert.deepEqual(sent(thinq), [{ t: 0x355, v: 0 }])
        assert.equal(remaining(), 0, 'write value is elapsed hours; never publish it as remaining hours')
        thinq.emit('data', SAMPLE_FILTER_NATIVE_RESET_NOTIFICATION)
        assert.equal(remaining(), 250)
        thinq.emit('data', SAMPLE_FILTER_NATIVE_RESET_AFTER)
        thinq.emit('data', SAMPLE_FILTER_HANDLER_RESET_AFTER)
        assert.equal(remaining(), 250)
        assert.equal(ha.getProperty(DEVICE_ID, 'filterlife', 'state'), 250)
    })

    test('native filter reset requires verified revision, capability and native filter reports', (t) => {
        for (const variant of ['revision', 'support', 'native-reset', 'remaining', 'lifetime']) {
            const { ha, thinq, dev } = makeDevice(t)
            const caps = tlvs(SAMPLE_CAPABILITIES).map(({ t, v }) => ({
                t,
                v:
                    t === 0x2da && variant === 'revision'
                        ? 0x346
                        : t === 0x2f1 && variant === 'support'
                          ? 0x200
                          : t === 0x2f1 && variant === 'native-reset'
                            ? 1
                            : v,
            }))
            thinq.emit('data', synthetic(caps))
            thinq.emit(
                'data',
                synthetic(
                    tlvs(SAMPLE_INITIAL).filter(
                        ({ t }) =>
                            !(variant === 'remaining' && t === 0x355) && !(variant === 'lifetime' && t === 0x356),
                    ),
                ),
            )
            thinq.resetRecorder()
            assert.equal(ha.devices[DEVICE_ID].config!.components.filterreset, undefined, variant)
            dev.setProperty('filterreset', 'PRESS')
            assert.equal(thinq.outbox.length, 0, variant)
        }
    })

    test('power-on includes the settings required by the real window unit', (t) => {
        const { ha, thinq, dev } = ready(t)
        const command = '01010400000065020101097DC17E427E867F90382932'
        const response = buf(
            '000004000000A70204E2477E427DC17E867F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD08CCB109BCB8CCBC0CC00CC909A1B00C0C03026',
        )
        const off = buf(
            '000004000000A70204C9477E427DC07E867F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD08CCB109CCB8CCBC0CC00CC909B1B00C0C0BB72',
        )
        thinq.emit('data', off)
        thinq.resetRecorder()
        dev.setProperty('climate-power', 'ON')
        assert.equal(hex(thinq.outbox[0]), command)
        thinq.emit('data', response)
        assert.equal(ha.getProperty(DEVICE_ID, 'climate', 'mode_state'), 'fan_only')
    })

    test('display writes use the live-verified polarity and are restricted to that revision', (t) => {
        const { ha, thinq } = ready(t)
        for (const [option, command, response] of [
            [
                'OFF',
                '010104000000650201010287C1E95D',
                '000004000000A7020417477E427DC17E867F503A7F90388180C8C08340868086C08700884089408A008A50548A808C808CC0ACD032D550F8D590FA87C1E800CAD08CCB109BCB8CCBC0CC00CC909A1B00C0C0EA4E',
            ],
            [
                'ON',
                '010104000000650201010287C0F97C',
                '000004000000A7020423477E427DC17E867F503A7F90388180C8C08340868086C08700884089408A008A50568A808C808CC0ACD032D550F8D590FA87C0E800CAD08CCB109BCB8CCBC0CC00CC909A1B00C0C0AF39',
            ],
        ] as const) {
            thinq.resetRecorder()
            ha.setProperty(DEVICE_ID, 'displaylight', 'command', option)
            assert.equal(hex(thinq.outbox[0]), command)
            thinq.emit('data', buf(response))
            assert.equal(ha.getProperty(DEVICE_ID, 'displaylight', 'state'), option)
        }
        const other = makeDevice(t)
        other.thinq.emit(
            'data',
            synthetic(tlvs(SAMPLE_CAPABILITIES).map(({ t, v }) => ({ t, v: t === 0x2da ? 123 : v }))),
        )
        other.thinq.emit('data', SAMPLE_INITIAL)
        assert.equal(other.ha.devices[DEVICE_ID].config!.components.displaylight, undefined)
    })

    test('native timers encode hours as minutes, read countdowns, and follow operating requirements', (t) => {
        const { ha, thinq, dev } = ready(t)
        for (const [component, id, power, captures] of [
            [
                'starttimer',
                0x21c,
                0,
                [
                    [
                        60,
                        '010104000000650201010387103C967A',
                        '000004000000A70204D2487E427DC07E867F50397F90388180C8C08340868086C087103C884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD08CCB109BCB8CCBC0CC00CC909B1B00C0C0CAC6',
                    ],
                    [
                        0,
                        '010104000000650201010287002030',
                        '000004000000A70204D9477E427DC07E867F50397F90388180C8C08340868086C08700884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD08CCB109BCB8CCBC0CC00CC909B1B00C0C0087C',
                    ],
                ],
            ],
            [
                'stoptimer',
                0x21b,
                1,
                [
                    [
                        60,
                        '010104000000650201010386D03CB71E',
                        '000004000000A702048E487E407DC17E867F503B7F90348180C8C08340868086D03C8700884089408A078A50558A8F8C808CC0ACD032D550F8D590FA87C0E800CAD08ECB1099CB8CCBCFCC00CC90991B01C0C0283A',
                    ],
                    [
                        0,
                        '010104000000650201010286C0CA4D',
                        '000004000000A7020498477E407DC17E867F503B7F90348180C8C08340868086C08700884089408A078A50558A8F8C808CC0ACD032D550F8D590FA87C0E800CAD08CCB109BCB8CCBCFCC00CC90991B01C0C06B8A',
                    ],
                ],
            ],
            [
                'sleeptimer',
                0x21a,
                1,
                [
                    [
                        60,
                        '010104000000650201010386903CBAD2',
                        '000004000000A70204A34A7E407DC17E867F503B7F90348180C8C0834086903C86C08700884089408A101B8A50558A8F8C808CD03BACD0AFD550F8D590FA87C1E800CAD08ACB109FCB8CCBCFCC00CC90991B01C0C0A355',
                    ],
                    [
                        0,
                        '010104000000650201010286808289',
                        '000004000000A70204AD497E407DC17E867F503B7F90348180C8C08340868086C08700884089408A101B8A50558A8F8C808CD03BACD0AFD550F8D590FA87C0E800CAD089CB10A4CB8CCBCFCC00CC90991B01C0C06350',
                    ],
                ],
            ],
        ] as const) {
            dev.processTLV([
                { t: 0x1f7, v: power },
                { t: 0x1f9, v: 0 },
            ])
            assert.equal(ha.devices[DEVICE_ID].properties[component + '/availability'], 'online')
            for (const [value, command, response] of captures) {
                thinq.resetRecorder()
                ha.setProperty(DEVICE_ID, component, 'command', String(value / 60))
                assert.equal(hex(thinq.outbox[0]), command)
                thinq.emit('data', buf(response))
                assert.equal(ha.getProperty(DEVICE_ID, component, 'state'), value / 60)
            }
            thinq.resetRecorder()
            for (const invalid of ['', 'NaN', 'Infinity', '-1', '25', '0.5']) {
                ha.setProperty(DEVICE_ID, component, 'command', invalid)
            }
            assert.equal(thinq.outbox.length, 0)
            // Synthetic out-of-range response; do not turn corrupt data into a plausible timer.
            dev.processTLV([{ t: id, v: 0xffffff }])
            assert.equal(ha.getProperty(DEVICE_ID, component, 'state'), 0)
        }
        const countdown = buf(
            '000004000000A7020457487E427DC07E867F50397F90388180C8C08340868086C087103B884089408A008A50558A808C808CC0ACD032D550F8D590FA87C0E800CAD085CB10A3CB8CCBC0CC00CC909B1B00C0C02542',
        )
        thinq.emit('data', countdown)
        assert.equal(dev.raw_clip_state[0x21c], 59)
        assert.equal(ha.getProperty(DEVICE_ID, 'starttimer', 'state'), 1)
        thinq.resetRecorder()
        ha.setProperty(DEVICE_ID, 'stoptimer', 'command', '1')
        ha.setProperty(DEVICE_ID, 'sleeptimer', 'command', '1')
        assert.equal(thinq.outbox.length, 0, 'off unit accepts only the turn-on timer')
        dev.processTLV([
            { t: 0x1f7, v: 1 },
            { t: 0x1f9, v: 2 },
        ])
        assert.equal(ha.devices[DEVICE_ID].properties['starttimer/availability'], 'offline')
        assert.equal(ha.devices[DEVICE_ID].properties['sleeptimer/availability'], 'offline')
    })

    test('timer discovery uses verified ranges and omits unreported timer fields', (t) => {
        const { ha } = ready(t)
        const components = ha.devices[DEVICE_ID].config!.components as Record<string, Record<string, unknown>>
        assert.equal(components.sleeptimer.max, 12)
        assert.equal(components.starttimer.max, 24)
        assert.equal(components.stoptimer.max, 24)
        assert.equal(components.starttimer.step, 1)
        assert.equal(components.starttimer.unit_of_measurement, 'h')
        assert.deepEqual(components.starttimer.availability, [
            { topic: '$this/availability' },
            { topic: '$rethink/availability' },
            { topic: '$this/starttimer/availability' },
        ])
        const other = makeDevice(t)
        other.thinq.emit('data', SAMPLE_CAPABILITIES)
        other.thinq.emit('data', synthetic(tlvs(SAMPLE_INITIAL).filter(({ t }) => ![0x21a, 0x21b, 0x21c].includes(t))))
        assert.equal(other.ha.devices[DEVICE_ID].config!.components.starttimer, undefined)
        assert.equal(other.ha.devices[DEVICE_ID].config!.components.stoptimer, undefined)
        assert.equal(other.ha.devices[DEVICE_ID].config!.components.sleeptimer, undefined)
    })
})
