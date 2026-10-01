import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Button,
  Card,
  Chip,
  Drawer,
  Field,
  FieldActions,
  FieldGrid,
  Input,
  initials,
  PageHeader,
  Person,
  Select,
  Table,
  Td,
  Th,
  Toast,
  TopNav,
} from "../src/index.ts";

const html = renderToStaticMarkup;

describe("app theme (09 section 2)", () => {
  it("defines the design tokens and respects reduced motion", () => {
    const css = readFileSync(new URL("../theme-app.css", import.meta.url), "utf8");
    for (const token of [
      "--ink: #0b1830",
      "--blue: #1f5be8",
      "--bg: #eef0f3",
      "--font-sans: var(--font-geist)",
    ]) {
      expect(css).toContain(token);
    }
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

describe("components", () => {
  it("Chip puts a check before a done state's words", () => {
    const markup = html(
      <Chip tone="green" check>
        Settled
      </Chip>,
    );
    expect(markup).toMatch(/^<span class="chip green"><svg class="check"[^>]*aria-hidden="true">/);
    expect(markup.replace(/<svg[\s\S]*<\/svg>/, "")).toBe(
      '<span class="chip green">Settled</span>',
    );
  });

  it("Person shows initials in the avatar, the name and the line under it", () => {
    expect(initials("Maya Chen")).toBe("MC");
    expect(initials("  daniel  van der Berg ")).toBe("DB");
    expect(initials("Northwind")).toBe("N");
    expect(html(<Person name="Maya Chen" detail="Design lead" size={34} />)).toBe(
      '<span class="person"><span class="avatar" style="width:34px;height:34px" aria-hidden="true">MC</span><span class="text"><b>Maya Chen</b><small>Design lead</small></span></span>',
    );
    expect(html(<Person name="Northwind Ltd" business />)).toContain('class="avatar business"');
  });

  it("Field puts the label above its control, then the hint and the problem (13 A35)", () => {
    const markup = html(
      <FieldGrid>
        <Field label="Name" htmlFor="name" hint="As on the invoice" error="Enter a name." wide>
          <Input id="name" aria-invalid />
        </Field>
        <Field label="Country" htmlFor="country">
          <Select id="country">
            <option value="">Not set</option>
          </Select>
        </Field>
        <FieldActions>
          <Button>Add</Button>
        </FieldActions>
      </FieldGrid>,
    );
    expect(markup).toBe(
      '<div class="grid"><div class="field wide"><label class="label" for="name">Name</label><input class="control" id="name" aria-invalid="true"/><small id="name-hint" class="hint">As on the invoice</small><small id="name-error" class="error">Enter a name.</small></div><div class="field"><label class="label" for="country">Country</label><select class="control select" id="country"><option value="">Not set</option></select></div><div class="actions"><button type="button" class="button">Add</button></div></div>',
    );
  });

  it("Button renders a typed button with the design variants", () => {
    expect(html(<Button>Go</Button>)).toBe('<button type="button" class="button">Go</button>');
    expect(
      html(
        <Button variant="blue" size="sm">
          Go
        </Button>,
      ),
    ).toContain('class="button blue sm"');
    expect(
      html(
        <Button variant="line" size="lg" disabled>
          Go
        </Button>,
      ),
    ).toContain('class="button line lg" disabled=""');
  });

  it("Chip applies its tone", () => {
    expect(html(<Chip>Devnet</Chip>)).toBe('<span class="chip">Devnet</span>');
    expect(html(<Chip tone="amber">Pending</Chip>)).toContain('class="chip amber"');
  });

  it("Card is a section, light or dark", () => {
    expect(html(<Card>x</Card>)).toBe('<section class="card">x</section>');
    expect(html(<Card tone="dark">x</Card>)).toContain('class="card dark"');
  });

  it("PageHeader renders the overline, the title as the page heading and the actions", () => {
    const markup = html(
      <PageHeader overline="Signed in" title="Welcome" actions={<Button>Act</Button>} />,
    );
    expect(markup).toContain('<small class="overline">Signed in</small>');
    expect(markup).toContain('<h1 class="title">Welcome</h1>');
    expect(markup).toContain('class="actions"');
  });

  it("TopNav renders only the given items, marks the active one, and nothing when empty", () => {
    expect(html(<TopNav items={[]} />)).toBe("");
    const markup = html(
      <TopNav
        items={[
          { key: "o", label: "Overview", href: "/app/x/overview", active: true },
          { key: "p", label: "Payroll", href: "/app/x/payroll", badge: 2 },
        ]}
      />,
    );
    expect(markup).toContain('<nav class="nav" aria-label="Main">');
    expect(markup).toContain(
      '<a href="/app/x/overview" class="item active" aria-current="page">Overview</a>',
    );
    expect(markup).toContain('<span class="badge">2</span>');
  });

  it("Table keeps column headers semantic", () => {
    const markup = html(
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th align="right">Status</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>A</Td>
            <Td align="right">Ready</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(markup).toContain('<table class="table">');
    expect(markup).toContain('<th scope="col" class="right">Status</th>');
    expect(markup).toContain('<td class="right">Ready</td>');
  });

  it("Drawer is a labelled modal dialog with a close button, and renders nothing when closed", () => {
    expect(
      html(
        <Drawer open={false} title="T" onClose={() => {}}>
          b
        </Drawer>,
      ),
    ).toBe("");
    const markup = html(
      <Drawer
        open
        title="Payment detail"
        subtitle="Sealed"
        footer={<Button>Done</Button>}
        onClose={() => {}}
      >
        body
      </Drawer>,
    );
    expect(markup).toMatch(/role="dialog" aria-modal="true" aria-labelledby="[^"]+"/);
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(markup)?.[1];
    expect(markup).toContain(`<h3 id="${labelledBy}" class="title">Payment detail</h3>`);
    expect(markup).toContain('aria-label="Close"');
    expect(markup).toContain('<div class="foot">');
  });

  it("Toast is announced politely", () => {
    const markup = html(<Toast>Saved</Toast>);
    expect(markup).toContain('role="status" aria-live="polite"');
    expect(html(<Toast tone="error">Failed</Toast>)).toContain('class="toast error"');
  });
});
