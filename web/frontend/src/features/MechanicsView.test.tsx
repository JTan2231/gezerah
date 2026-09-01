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
    const inputMeasure: MechanicViewModel = {
      id: "input-measure",
      kind: "capacity",
      mode: "score",
      sourceKind: "input",
      name: "Input measure",
      minimum: "0",
      defaultNumber: "0",
      step: "1",
      mutableDuringPlay: true,
      archived: false,
    };
    const derivedMeasure: MechanicViewModel = {
      id: "derived-measure",
      kind: "capacity",
      mode: "score",
      sourceKind: "derived",
      name: "Derived measure",
      mutableDuringPlay: false,
      expression: {
        operation: "mechanic-reference",
        mechanicId: inputMeasure.id,
      },
      archived: false,
    };

    const html = renderToStaticMarkup(
      <MechanicsView
        kind="capacity"
        selectedId={derivedMeasure.id}
        items={[inputMeasure, derivedMeasure]}
        loading={false}
        issue={null}
        onRetry={noop}
        onSelect={noop}
        editor={
          <MechanicEditorView
            source={derivedMeasure}
            allMechanics={[inputMeasure, derivedMeasure]}
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
    expect(html).toContain("Derived measure");
    expect(html).toContain("Expression");
    expect(html).toContain("Input measure · Number");
    expect(html).toContain("Derived");
  });
});
