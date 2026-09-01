import { strict as assert } from "node:assert";
import { describe, test } from "bun:test";

import { parseCompleteWorldEvents } from "../playwright/worldEventStream";

describe("world-event stream projection", () => {
  test("reassembles complete SSE frames across arbitrary response chunks", () => {
    const events = parseCompleteWorldEvents([
      'retry: 1500\n\nid: 41\nevent: world-event\ndata: {"id":41,"type":"resol',
      'ution-committed","resolution_id":"resolution-1"}\n',
      "\nid: 42\r\nevent: world-event\r\ndata:",
      ' {"id":42,"type":"world-updated"}\r\n\r\n',
    ]);

    assert.deepEqual(events, [
      {
        id: 41,
        type: "resolution-committed",
        resolution_id: "resolution-1",
      },
      { id: 42, type: "world-updated" },
    ]);
  });

  test("does not parse a trailing frame until its blank-line delimiter arrives", () => {
    const completeEvent =
      'id: 51\nevent: world-event\ndata: {"id":51,"type":"resolution-committed"}\n\n';

    assert.deepEqual(
      parseCompleteWorldEvents([
        completeEvent,
        'id: 52\nevent: world-event\ndata: {"id":52,"type":"world-upd',
      ]),
      [{ id: 51, type: "resolution-committed" }],
    );
    assert.deepEqual(
      parseCompleteWorldEvents(['data: {"id":52,"type":"world-updated"}']),
      [],
    );
  });
});
