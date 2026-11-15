export const PANEL_STYLES = `
:host {
  all: initial;
}

* {
  box-sizing: border-box;
}

.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #111;
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(1040px, 94vw);
  height: min(760px, 90vh);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #e3e3e3;
  background: #fafafa;
}

header h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

header .spacer {
  flex: 1;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #ececec;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #666;
}

.field.grow {
  flex: 1;
  min-width: 180px;
}

input[type="text"],
input[type="number"],
select {
  padding: 7px 8px;
  border: 1px solid #c4c4c4;
  border-radius: 6px;
  background: #fff;
  font: 13px/1.3 inherit;
  color: #111;
  text-transform: none;
  letter-spacing: normal;
}

input[type="text"]:focus,
input[type="number"]:focus,
select:focus {
  outline: 2px solid #4b8bff;
  outline-offset: -1px;
}

button {
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 8px 12px;
  background: #111;
  color: #fff;
  font: 600 13px/1.2 inherit;
  cursor: pointer;
  white-space: nowrap;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

button.secondary {
  background: #fff;
  color: #222;
  border-color: #c4c4c4;
}

button.danger {
  background: #a11d1d;
}

button.ghost {
  background: transparent;
  color: #444;
  border-color: transparent;
  padding: 6px 8px;
}

button.ghost:hover {
  background: #eee;
}

.selection-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid #ececec;
  background: #f7f7f7;
  font-size: 12px;
}

.selection-bar .count {
  font-weight: 700;
}

.list {
  flex: 1;
  overflow: auto;
  position: relative;
}

table {
  width: 100%;
  border-collapse: collapse;
}

thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #fff;
  border-bottom: 1px solid #ddd;
  padding: 8px 10px;
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #666;
  cursor: pointer;
  user-select: none;
}

thead th.plain {
  cursor: default;
}

tbody td {
  padding: 7px 10px;
  border-bottom: 1px solid #f0f0f0;
  vertical-align: middle;
}

tbody tr:hover {
  background: #f6f9ff;
}

tbody tr.selected {
  background: #eaf1ff;
}

td.check,
th.check {
  width: 34px;
  text-align: center;
}

td.title {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

td.project,
td.updated {
  color: #555;
  white-space: nowrap;
}

td.state {
  white-space: nowrap;
  font-weight: 600;
}

.badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.badge.none {
  background: #eee;
  color: #666;
}

.badge.project {
  background: #e7f0ff;
  color: #1b4fa0;
}

.badge.pending {
  background: #f1f1f1;
  color: #555;
}

.badge.moving {
  background: #fff3d6;
  color: #8a5b00;
}

.badge.moved {
  background: #e0f6e4;
  color: #166a2c;
}

.badge.failed {
  background: #fde4e4;
  color: #96201f;
}

footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-top: 1px solid #e3e3e3;
  background: #fafafa;
}

footer .status {
  flex: 1;
  min-width: 200px;
  font-size: 12px;
  color: #444;
}

.message {
  padding: 18px;
  text-align: center;
  color: #666;
}

.message.error {
  color: #96201f;
  font-weight: 600;
}

.hint {
  font-size: 11px;
  color: #777;
}

@media (prefers-color-scheme: dark) {
  .panel {
    background: #1d1d1f;
    color: #eee;
  }

  header,
  footer,
  .selection-bar {
    background: #252528;
    border-color: #3a3a3d;
  }

  .toolbar,
  thead th,
  tbody td {
    border-color: #343437;
  }

  thead th {
    background: #1d1d1f;
    color: #aaa;
  }

  tbody tr:hover {
    background: #26303f;
  }

  tbody tr.selected {
    background: #2b3750;
  }

  input[type="text"],
  input[type="number"],
  select {
    background: #2a2a2d;
    border-color: #4a4a4e;
    color: #eee;
  }

  button {
    background: #eee;
    color: #111;
  }

  button.secondary {
    background: #2a2a2d;
    color: #eee;
    border-color: #4a4a4e;
  }

  button.danger {
    background: #b32b2b;
    color: #fff;
  }

  button.ghost {
    color: #ccc;
  }

  button.ghost:hover {
    background: #343438;
  }

  footer .status,
  .message {
    color: #bbb;
  }
}
`;
