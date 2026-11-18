import TLVDevice from './tlv_device'
import { Device as Thinq2Device } from '../thinq2/device'
import { DeviceDiscovery, type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import * as TLV from '@/util/tlv'
import HADevice from './base'
import { Enum } from '@/util/enum'

const ENERGY_LIMITS = Enum.of({
    off: 0,
    '80%': 80,
    '60%': 60,
    '40%': 40,
})

const FAN_MODES = Enum.of({
    low: 2,
    medium: 4,
    high: 6,
})

const MODES = Enum.of({
    cool: 0,
    dry: 1,
    fan_only: 2,
    heat: 4,
})

const SWING_MODES = Enum.of({
    on: 100,
    off: 0,
})

/**
 * LG window air conditioners, including LW1823HRSM and LA130GC.
 * The ThinQ model ID is shared by cooling-only and heating units; use their TLV capabilities.
 */
export default class Device extends TLVDevice {
    constructor(
        HA: Connection,
        thinq: Thinq2Device,
        readonly meta: Metadata,
    ) {
        super(HA, thinq)
    }

    valuesReceived() {
        if (this.config) return
        // Command attachments must come from the appliance, never from missing cached values.
        if ([0x1f7, 0x1f9, 0x1fa, 0x1fe].some((id) => this.raw_clip_state[id] == null)) return

        const modeMask = this.raw_clip_state[0x2c1]
        const fanMask = this.raw_clip_state[0x2c2]
        const modes = new Enum(
            MODES.entries.filter(([mode, code]) =>
                modeMask == null ? mode !== 'dry' : !!(modeMask & (1 << Number(code))),
            ),
        )
        const fans = new Enum(
            FAN_MODES.entries.filter(([fan, code]) =>
                fanMask == null ? fan !== 'medium' : !!(fanMask & (1 << Number(code))),
            ),
        )
        const minTemp = (this.raw_clip_state[0x2e1] || 32) / 2
        const maxTemp = (this.raw_clip_state[0x2e2] || 60) / 2
        // tempCtrl is a bitset of modelJSON enum positions: bit 0 = 1 C, bit 1 = 0.5 C.
        const tempStep = this.raw_clip_state[0x2c4] == null || this.raw_clip_state[0x2c4] & 2 ? 0.5 : 1
        const hasSwing =
            this.raw_clip_state[0x322] != null &&
            (this.raw_clip_state[0x2cd] == null || !!(this.raw_clip_state[0x2cd] & 8))

        const config: DeviceDiscovery = allowExtendedType({
            ...HADevice.config(this.meta, { name: 'LG Air Conditioner' }),
            components: {
                climate: {
                    platform: 'climate',
                    unique_id: '$deviceid-climate',
                    name: null,
                    temperature_unit: 'C',
                    temp_step: tempStep,
                    precision: 0.5,
                    min_temp: minTemp,
                    max_temp: maxTemp,
                    modes: ['off', ...modes.options],
                    fan_modes: fans.options,
                    ...(hasSwing ? { swing_modes: SWING_MODES.options } : {}),
                    ...(this.raw_clip_state[0x6c] != null ? { action_topic: '$this/climate-action' } : {}),
                },
            },
        })

        this.addField(config, {
            id: 0x1fd,
            name: 'current_temperature',
            comp: 'climate',
            state_topic: 'topic',
            writable: false,
            read_xform: (raw) => raw / 2,
        })

        this.addField(config, {
            id: 0x1fe,
            name: 'temperature',
            comp: 'climate',
            read_xform: (raw) => raw / 2,
            write_xform: (valStr) => {
                const val = Number(valStr)
                if (!valStr.trim() || !Number.isFinite(val)) return
                const clamped = Math.max(minTemp, Math.min(maxTemp, val))
                return Math.round(clamped / tempStep) * tempStep * 2
            },
            write_attach: [0x1f9, 0x1fa],
        })

        this.addField(config, {
            id: 0x1f7,
            name: 'power',
            comp: 'climate',
            readable: false,
            write_xform: (val) => (val === 'ON' ? 1 : val === 'OFF' ? 0 : undefined),
            write_attach: (raw) => (raw ? [0x1f9, 0x1fa, 0x1fe] : []),
            read_xform: (raw) => (raw ? 'ON' : 'OFF'),
            read_callback: (val) => {
                // update 'mode' instead
                const mode = this.raw_clip_state[0x1f9]
                if (mode != null) this.processKeyValue(0x1f9, mode)
                return false
            },
        })

        this.addField(config, {
            id: 0x1f9,
            name: 'mode',
            comp: 'climate',
            read_xform: (raw) => {
                if (this.raw_clip_state[0x1f7] === 0) return 'off'
                if (this.raw_clip_state[0x1f7] !== 1) return
                return modes.map(raw)
            },
            write_xform: (val) => {
                if (val === 'off') {
                    // Call function power (0x1f7) with value OFF
                    this.setProperty('climate-power', 'OFF')
                    return
                }
                return modes.unmap(val)
            },
            write_callback: () => {
                // Power and new mode travel together, without briefly starting the previous mode.
                this.raw_clip_state[0x1f7] = 1
                return true
            },
            write_attach: [0x1f7, 0x1fa, 0x1fe],
        })

        this.addField(config, {
            id: 0x1fa,
            name: 'fan_mode',
            comp: 'climate',
            read_xform: (raw) => fans.map(raw),
            write_xform: (val) => fans.unmap(val),
            write_attach: [0x1f9, 0x1fe],
        })

        if (hasSwing)
            this.addField(config, {
                id: 0x322,
                name: 'swing_mode',
                comp: 'climate',
                read_xform: (raw) => SWING_MODES.map(raw),
                write_xform: (val) => SWING_MODES.unmap(val),
                write_attach: [0x1f9, 0x1fa],
            })

        // WINPOT_ADV_MOMENTARY (modelJSON accumMode enum 6) reports the same watts the LG cloud
        // calls airState.energy.onCurrent. Preserve the appliance estimate, including its standby
        // floor; the RAC single-split power correction does not apply to this window unit.
        if (this.raw_clip_state[0x2d5] & 0x20 && this.raw_clip_state[0x2b3] != null) {
            config.components.energy_current = allowExtendedType({
                platform: 'sensor',
                unique_id: '$deviceid-energy_current',
                name: 'Power',
                device_class: 'power',
                state_class: 'measurement',
                unit_of_measurement: 'W',
            })
            this.addField(config, { id: 0x2b3, name: '', comp: 'energy_current', writable: false })
        }

        if (this.raw_clip_state[0x221] != null) {
            config.components.error = allowExtendedType({
                platform: 'sensor',
                unique_id: '$deviceid-error',
                name: 'Error code',
                entity_category: 'diagnostic',
                icon: 'mdi:alert',
            })
            this.addField(config, { id: 0x221, name: '', comp: 'error', writable: false })
        }

        if (this.raw_clip_state[0x34f] & 0x400 && this.raw_clip_state[0x20d] != null) {
            config.components.energylimit = allowExtendedType({
                platform: 'select',
                unique_id: '$deviceid-energylimit',
                name: 'Active energy control',
                entity_category: 'config',
                icon: 'mdi:flash',
                options: ENERGY_LIMITS.options,
                availability: [...config.availability!, { topic: '$this/energylimit/availability' }],
                availability_mode: 'all',
            })
            this.addField(config, {
                id: 0x20d,
                name: '',
                comp: 'energylimit',
                read_xform: (raw) => ENERGY_LIMITS.map(raw),
                write_xform: (val) => ENERGY_LIMITS.unmap(val),
                write_callback: () => this.raw_clip_state[0x1f7] === 1 && this.raw_clip_state[0x1f9] === 0,
            })
        }

        // Window units report remaining hours in 0x355, despite the cloud's "useTime" name.
        if (this.raw_clip_state[0x2f1] & 1 && this.raw_clip_state[0x356] > 0) {
            for (const [id, name, label] of [
                [0x355, 'filterremaining', 'Filter remaining time'],
                [0x356, 'filterlife', 'Filter life time'],
            ] as const) {
                if (this.raw_clip_state[id] == null) continue
                config.components[name] = allowExtendedType({
                    platform: 'sensor',
                    unique_id: '$deviceid-' + name,
                    name: label,
                    device_class: 'duration',
                    unit_of_measurement: 'h',
                    entity_category: 'diagnostic',
                    icon: 'mdi:air-filter',
                })
                this.addField(config, { id, name: '', comp: name, writable: false })
            }
            if (
                this.raw_clip_state[0x2da] === 0x0522 &&
                this.raw_clip_state[0x2f1] & 0x200 &&
                this.raw_clip_state[0x355] != null
            ) {
                config.components.filterreset = allowExtendedType({
                    platform: 'button',
                    unique_id: '$deviceid-filterreset',
                    command_topic: '$this/filterreset/set',
                    name: 'Reset filter usage',
                    icon: 'mdi:calendar-refresh-outline',
                    entity_category: 'diagnostic',
                })
                this.fields_by_ha.filterreset = {
                    name: '',
                    comp: '',
                    write_xform: (val) => (val === 'PRESS' ? 0 : undefined),
                    write_callback: () => {
                        // This revision reads remaining hours but writes elapsed hours.
                        // Keep the sensor cache unchanged until the appliance reports its reset.
                        this.send([1, 1, 2, 1, 1], [{ t: 0x355, v: 0 }])
                        return false
                    },
                }
            }
        }

        for (const [id, name, label, icon, supported] of [
            [0x3a0, 'beep', 'Beep', 'mdi:volume-high', !!(this.raw_clip_state[0x374] & 4)],
            // Display polarity differs between LG indoor units; only expose this verified revision.
            [
                0x21f,
                'displaylight',
                'Display light',
                'mdi:lightbulb-outline',
                this.raw_clip_state[0x2da] === 0x0522 && !!(this.raw_clip_state[0x2d6] & 0x8000),
            ],
        ] as const) {
            if (!supported || this.raw_clip_state[id] == null) continue
            config.components[name] = allowExtendedType({
                platform: 'switch',
                unique_id: '$deviceid-' + name,
                name: label,
                icon,
                entity_category: 'config',
            })
            this.addField(config, {
                id,
                name: '',
                comp: name,
                read_xform: (raw) => (raw === 0 ? 'ON' : raw === 1 ? 'OFF' : undefined),
                write_xform: (val) => (val === 'ON' ? 0 : val === 'OFF' ? 1 : undefined),
            })
        }

        if (this.raw_clip_state[0x2d3] & 0x14 && this.raw_clip_state[0x21c] != null) {
            this.addTimerField(config, 0x21c, 'starttimer', 'Turn-on timer', 'mdi:timer-play', 24)
        }
        if (this.raw_clip_state[0x2d3] & 0x14 && this.raw_clip_state[0x21b] != null) {
            this.addTimerField(config, 0x21b, 'stoptimer', 'Turn-off timer', 'mdi:timer-stop', 24)
        }
        if (this.raw_clip_state[0x2d3] & 0x4000 && this.raw_clip_state[0x21a] != null) {
            this.addTimerField(config, 0x21a, 'sleeptimer', 'Sleep timer', 'mdi:bed-clock', 12)
        }

        this.setConfig(config)
        // Initial replies arrived before the fields were registered.
        for (const id of Object.keys(this.fields_by_id).map(Number)) {
            if (this.raw_clip_state[id] != null) this.processKeyValue(id, this.raw_clip_state[id])
        }
    }

    timerAvailable(name: 'starttimer' | 'stoptimer' | 'sleeptimer') {
        const power = this.raw_clip_state[0x1f7]
        if (name === 'starttimer') return power === 0
        return power === 1 && (name !== 'sleeptimer' || this.raw_clip_state[0x1f9] === 0)
    }

    addTimerField(
        config: DeviceDiscovery,
        id: number,
        name: 'starttimer' | 'stoptimer' | 'sleeptimer',
        label: string,
        icon: string,
        max: number,
    ) {
        config.components[name] = allowExtendedType({
            platform: 'number',
            unique_id: '$deviceid-' + name,
            name: label,
            icon,
            device_class: 'duration',
            unit_of_measurement: 'h',
            min: 0,
            max,
            step: 1,
            mode: 'slider',
            availability: [...config.availability!, { topic: '$this/' + name + '/availability' }],
            availability_mode: 'all',
        })
        this.addField(config, {
            id,
            name: '',
            comp: name,
            read_xform: (raw) => (raw <= max * 60 ? Math.ceil(raw / 60) : undefined),
            write_xform: (val) => {
                const hours = Number(val)
                if (!val.trim() || !Number.isInteger(hours) || hours < 0 || hours > max) return
                return hours * 60
            },
            write_callback: () => this.timerAvailable(name),
        })
    }

    processTLV(tlvArray: TLV.TLV[]) {
        super.processTLV(tlvArray)
        // A missing initial field may arrive in a later partial notification.
        if (!this.config && this.query_caps_timeout == null) this.valuesReceived()
        if (!this.config) return

        const power = this.raw_clip_state[0x1f7]
        const mode = this.raw_clip_state[0x1f9]
        if (this.config.components.energylimit) {
            this.publishProperty('energylimit/availability', power === 1 && mode === 0 ? 'online' : 'offline')
        }
        for (const name of ['starttimer', 'stoptimer', 'sleeptimer'] as const) {
            if (this.config.components[name]) {
                this.publishProperty(name + '/availability', this.timerAvailable(name) ? 'online' : 'offline')
            }
        }
        if (this.raw_clip_state[0x6c] != null) {
            const active = this.raw_clip_state[0x6c]
            const actions: Record<number, string> = { 0: 'cooling', 1: 'drying', 4: 'heating' }
            const action =
                power === 0
                    ? 'off'
                    : mode === 2
                      ? 'fan'
                      : active === 0
                        ? 'idle'
                        : active === 1
                          ? actions[mode]
                          : undefined
            this.publishProperty('climate-action', action)
        }
    }

    isCapsResponse(tlvArray: TLV.TLV[]) {
        /* eeprom checksum */
        return tlvArray.some(({ t, v }) => t === 0x2da)
    }

    isValuesResponse(tlvArray: TLV.TLV[]) {
        /* power */
        return tlvArray.length >= 10 && tlvArray.some(({ t, v }) => t === 0x1f7)
    }
}
