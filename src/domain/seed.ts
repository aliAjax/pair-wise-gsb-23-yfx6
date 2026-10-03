import type { Device, OfflinePacket } from "../types";

export const DEVICES: Device[] = [
  {
    id: "PC-01",
    name: "粒子计数器 PC-01",
    kind: "particleCounter",
    roomId: "CR-1201",
    fields: ["particle"],
  },
  {
    id: "DP-01",
    name: "压差计 DP-01",
    kind: "pressureGauge",
    roomId: "CR-1201",
    fields: ["pressure"],
  },
  {
    id: "PC-02",
    name: "粒子计数器 PC-02",
    kind: "particleCounter",
    roomId: "CR-2107",
    fields: ["particle"],
  },
  {
    id: "DP-02",
    name: "压差计 DP-02",
    kind: "pressureGauge",
    roomId: "CR-2107",
    fields: ["pressure"],
  },
  {
    id: "PC-03",
    name: "粒子计数器 PC-03",
    kind: "particleCounter",
    roomId: "CR-3310",
    fields: ["particle"],
  },
  {
    id: "TH-04",
    name: "温湿度仪 TH-04",
    kind: "tempHumidityMeter",
    roomId: "Y-0302",
    fields: ["tempHumidity"],
  },
];

const day = "2026-10-03";

export const PACKETS_SEED = {
  // 白班 08:00：两人分头巡检，字段互不重叠 -> 按字段合并
  wave1: [
    {
      id: "P-seed-1",
      submitter: "巡检员 李航",
      shift: "A" as const,
      basis: "offline" as const,
      label: "白班离线-李航",
      arrivedAt: 0,
      entries: [
        { roomId: "CR-1201", point: `${day}T08:00`, field: "particle" as const, value: "3860 颗/m³", capturedAt: `${day}T08:00`, deviceId: "PC-01" },
        { roomId: "CR-1201", point: `${day}T08:00`, field: "pressure" as const, value: "18 Pa", capturedAt: `${day}T08:00`, deviceId: "DP-01" },
        { roomId: "CR-1201", point: `${day}T08:00`, field: "tempHumidity" as const, value: "22.1℃ / 47%RH", capturedAt: `${day}T08:00` },
        { roomId: "CR-1201", point: `${day}T08:00`, field: "equipmentStatus" as const, value: "运行", capturedAt: `${day}T08:00` },
        { roomId: "CR-1201", point: `${day}T08:00`, field: "note" as const, value: "0.5um 粒子超限，已通知厂务复核", capturedAt: `${day}T08:03` },
      ],
    },
    {
      id: "P-seed-2",
      submitter: "巡检员 王珂",
      shift: "A" as const,
      basis: "offline" as const,
      label: "白班离线-王珂",
      arrivedAt: 0,
      entries: [
        { roomId: "CR-2107", point: `${day}T08:00`, field: "particle" as const, value: "9800 颗/m³", capturedAt: `${day}T08:00`, deviceId: "PC-02" },
        { roomId: "CR-2107", point: `${day}T08:00`, field: "pressure" as const, value: "15 Pa", capturedAt: `${day}T08:00`, deviceId: "DP-02" },
        { roomId: "Y-0302", point: `${day}T08:00`, field: "tempHumidity" as const, value: "23.4℃ / 58%RH", capturedAt: `${day}T08:00`, deviceId: "TH-04" },
        { roomId: "Y-0302", point: `${day}T08:00`, field: "note" as const, value: "湿度接近上限，持续观察", capturedAt: `${day}T08:00` },
      ],
    },
  ],
  // 09:20 网络恢复：王珂补录 CR-2107 压差（旧表读数 15Pa 与李航手持表 12Pa 不同），CR-1201 补备注
  wave2: [
    {
      id: "P-seed-3",
      submitter: "巡检员 王珂",
      shift: "A" as const,
      basis: "offline" as const,
      label: "网络恢复补传-王珂",
      arrivedAt: 0,
      entries: [
        { roomId: "CR-2107", point: `${day}T08:00`, field: "pressure" as const, value: "12 Pa", capturedAt: `${day}T08:05`, deviceId: "DP-02" },
        { roomId: "CR-2107", point: `${day}T08:00`, field: "note" as const, value: "压差两表读数不一致，已留双版本", capturedAt: `${day}T08:10` },
      ],
    },
  ],
  // 12:00 午班：CR-1201 粒子超限异常（活动未封存）；CR-3310 两人对设备状态不同说法 -> 待复核
  wave3: [
    {
      id: "P-seed-4",
      submitter: "巡检员 李航",
      shift: "A" as const,
      basis: "offline" as const,
      label: "午班离线-李航",
      arrivedAt: 0,
      entries: [
        { roomId: "CR-1201", point: `${day}T12:00`, field: "particle" as const, value: "4180 颗/m³", capturedAt: `${day}T12:00`, deviceId: "PC-01" },
        { roomId: "CR-1201", point: `${day}T12:00`, field: "pressure" as const, value: "16 Pa", capturedAt: `${day}T12:00`, deviceId: "DP-01" },
        { roomId: "CR-1201", point: `${day}T12:00`, field: "tempHumidity" as const, value: "22.6℃ / 49%RH", capturedAt: `${day}T12:00` },
        { roomId: "CR-1201", point: `${day}T12:00`, field: "note" as const, value: "0.5um 粒子超限，已通知厂务", capturedAt: `${day}T12:02` },
        { roomId: "CR-3310", point: `${day}T12:00`, field: "particle" as const, value: "120000 颗/m³", capturedAt: `${day}T12:00`, deviceId: "PC-03" },
        { roomId: "CR-3310", point: `${day}T12:00`, field: "equipmentStatus" as const, value: "运行", capturedAt: `${day}T12:00` },
      ],
    },
    {
      id: "P-seed-5",
      submitter: "巡检员 王珂",
      shift: "A" as const,
      basis: "offline" as const,
      label: "午班离线-王珂",
      arrivedAt: 0,
      entries: [
        { roomId: "CR-3310", point: `${day}T12:00`, field: "equipmentStatus" as const, value: "校准中", capturedAt: `${day}T12:03` },
      ],
    },
  ],
};

/** 场景一：同一房间两人改不同字段 + 同字段冲突（演示合并与双版本待复核） */
export function scenarioMergePackets(): Omit<OfflinePacket, "arrivedAt">[] {
  return [
    {
      id: `P-demo-merge-a`,
      submitter: "巡检员 李航",
      shift: "A",
      basis: "offline",
      label: "演示-李航离线",
      entries: [
        { roomId: "CR-1201", point: `${day}T16:00`, field: "particle", value: "1480 颗/m³", capturedAt: `${day}T16:00`, deviceId: "PC-01" },
        { roomId: "CR-1201", point: `${day}T16:00`, field: "pressure", value: "19 Pa", capturedAt: `${day}T16:00`, deviceId: "DP-01" },
      ],
    },
    {
      id: `P-demo-merge-b`,
      submitter: "巡检员 王珂",
      shift: "A",
      basis: "offline",
      label: "演示-王珂离线",
      entries: [
        // 不同字段：合并
        { roomId: "CR-1201", point: `${day}T16:00`, field: "tempHumidity", value: "22.8℃ / 51%RH", capturedAt: `${day}T16:02` },
        // 同字段不同值：两版并存待复核（9Pa 接近告警边界，裁决后判定会变）
        { roomId: "CR-1201", point: `${day}T16:00`, field: "pressure", value: "9 Pa", capturedAt: `${day}T16:02`, deviceId: "DP-01" },
      ],
    },
  ];
}

/** 场景二：两班同一时间点提交，先到接受、后到草稿 */
export function scenarioRacePackets(): Omit<OfflinePacket, "arrivedAt">[] {
  return [
    {
      id: "P-demo-race-a",
      submitter: "巡检员 李航（白班）",
      shift: "A",
      basis: "offline",
      label: "演示-白班先到",
      entries: [
        { roomId: "CR-2107", point: `${day}T20:00`, field: "particle", value: "12000 颗/m³", capturedAt: `${day}T20:00`, deviceId: "PC-02" },
        { roomId: "CR-2107", point: `${day}T20:00`, field: "pressure", value: "17 Pa", capturedAt: `${day}T20:00`, deviceId: "DP-02" },
      ],
    },
    {
      id: "P-demo-race-b",
      submitter: "巡检员 赵宁（夜班）",
      shift: "B",
      basis: "offline",
      label: "演示-夜班后到",
      entries: [
        { roomId: "CR-2107", point: `${day}T20:00`, field: "particle", value: "13500 颗/m³", capturedAt: `${day}T20:00`, deviceId: "PC-02" },
        { roomId: "CR-2107", point: `${day}T20:00`, field: "pressure", value: "16 Pa", capturedAt: `${day}T20:00`, deviceId: "DP-02" },
      ],
    },
  ];
}

/** 场景三：写盘失败批次（完整批次 5 条，注入在第 2 条后失败，恢复只补 3 条） */
export function scenarioFailedPacket(): Omit<OfflinePacket, "arrivedAt"> {
  return {
    id: "P-demo-fail",
    submitter: "巡检员 王珂",
    shift: "B",
    basis: "offline",
    label: "演示-写盘失败批次",
    entries: [
      { roomId: "Y-0302", point: `${day}T22:00`, field: "tempHumidity", value: "23.0℃ / 55%RH", capturedAt: `${day}T22:00`, deviceId: "TH-04" },
      { roomId: "Y-0302", point: `${day}T22:00`, field: "note", value: "黄光区夜班巡检", capturedAt: `${day}T22:01` },
      { roomId: "Y-0302", point: `${day}T23:00`, field: "tempHumidity", value: "23.2℃ / 57%RH", capturedAt: `${day}T23:00`, deviceId: "TH-04" },
      { roomId: "Y-0302", point: `${day}T23:00`, field: "note", value: "湿度仍在稳定区", capturedAt: `${day}T23:01` },
      { roomId: "Y-0302", point: `${day}T00:00`, field: "note", value: "跨班交接备注", capturedAt: `${day + 1}T00:00` },
    ],
  };
}

/** 校准后复测：CR-1201 12:00 异常记录的新粒子读数 */
export function scenarioRemeasurePacket(): Omit<OfflinePacket, "arrivedAt"> {
  return {
    id: "P-demo-recheck",
    submitter: "厂务工程师 孙工",
    shift: "A",
    basis: "live",
    label: "校准后复测",
    entries: [
      { roomId: "CR-1201", point: `${day}T12:00`, field: "particle", value: "1980 颗/m³", capturedAt: `${day}T12:40`, deviceId: "PC-01" },
      { roomId: "CR-1201", point: `${day}T12:00`, field: "note", value: "校准后复测合格，异常关闭", capturedAt: `${day}T12:41` },
    ],
  };
}
