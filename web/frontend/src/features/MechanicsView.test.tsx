import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MechanicEditorView,
  MechanicsView,
  type MechanicViewModel,
} from "./MechanicsView";

const noop = () => undefined;
const noSave = () => Promise.resolve(undefined);

describe("MechanicsView", () => {
  test("renders the catalog and recursive editor from semantic fixtures", () => {
    const armor: MechanicViewModel = {
      id: "armor",
      kind: "capacity",
      mode: "score",
      sourceKind: "input",
      name: "Armor",
      minimum: "0",
      defaultNumber: "0",
      step: "1",
      mutableDuringPlay: true,
      archived: false,
    };
    const defense: MechanicViewModel = {
      id: "defense",
      kind: "capacity",
      mode: "score",
      sourceKind: "derived",
      name: "Defense",
      mutableDuringPlay: false,
      expression: {
        operation: "mechanic-reference",
        mechanicId: armor.id,
      },
      archived: false,
    };

    const html = renderToStaticMarkup(
      <MechanicsView
        kind="capacity"
        selectedId={defense.id}
        items={[armor, defense]}
        loading={false}
        issue={null}
        onRetry={noop}
        onSelect={noop}
        editor={
          <MechanicEditorView
            source={defense}
            allMechanics={[armor, defense]}
            creating={false}
            saving={false}
            archiving={false}
            issue={null}
            onSave={noSave}
            onArchive={noSave}
            onSaved={noop}
            onArchived={noop}
            onCancel={noop}
          />
        }
      />,
    );

    expect(html).toContain("Capacities");
    expect(html).toContain("Defense");
    expect(html).toContain("Calculation");
    expect(html).toContain("Armor · Number");
    expect(html).toContain("Calculated");
  });
});
