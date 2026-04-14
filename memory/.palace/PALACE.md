# Memory Palace — .palace

> 跨對話的長期記憶系統。每次新對話開始時，Claude 應讀取此檔 + 相關 wing。

## 架構

```
memory/
├── PALACE.md              ← 你在這裡（索引 + 指引）
├── palace_map.html        ← 互動式視覺化地圖（Wings/Graph/Tunnels/Agents 四個 tab）
├── wings/
│   └── coding,research,infrastructure/
└── tunnels/                   ← 跨 wing 的概念連結

agents/                        ← Agent system prompts（在根目錄，不在 memory/ 內）
├── research-writer.md
├── ui-ux-designer.md
├── hr-manager.md
├── code-reviewer.md
└── experiment-runner.md
```

## Wings 摘要（Hot Cache）

| Wing | 狀態 | 最近活動 | 關鍵數字/結論 |
|------|------|---------|-------------|
| coding,research,infrastructure | new | (無) | (無) |

## Tunnels（跨 Wing 連結）

| Tunnel | 連結的 Wings | 核心洞察 |
|--------|-------------|---------|
| (無) | (無) | (無) |

## 使用指南（給 Claude）

1. **每次新對話**: 讀 PALACE.md 了解全局，再根據使用者問題讀對應 wing
2. **對話結束前**: 把本次的重要發現/決策/數據寫回對應 wing
3. **發現跨主題連結時**: 寫一個 tunnel 檔案
4. **更新 Hot Cache**: 如果 wing 的狀態/關鍵數字有變，更新上面的表格
5. **數字要精確**: Hot Cache 的數字必須和 wing notes 裡的一致

---

Generated: 2026-04-15 04:52:17
