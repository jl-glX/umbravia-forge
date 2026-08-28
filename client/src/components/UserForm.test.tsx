// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import type { TFunction } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserActionError, type User } from "../hooks/useUsers";
import {
  ManagedUserFormDialogFrame,
  ManagedUserFormFields,
  UserForm,
} from "./UserForm";
import {
  formatManagedUserFormError,
  submitManagedUserForm,
  type ManagedUserFormDraft,
} from "../lib/managed-user-form";

const formMocks = vi.hoisted(() => ({
  inviteUser: vi.fn(),
  updateUser: vi.fn(),
  currentUser: { facility: { role: "owner" } } as {
    facility?: { role: string };
  } | null,
}));

vi.mock("../hooks/useUsers", async () => {
  const actual =
    await vi.importActual<typeof import("../hooks/useUsers")>(
      "../hooks/useUsers",
    );
  return {
    ...actual,
    useUsers: () => ({
      inviteUser: formMocks.inviteUser,
      updateUser: formMocks.updateUser,
    }),
  };
});
vi.mock("../hooks/useCurrentUser", () => ({
  useCurrentUser: () => formMocks.currentUser,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      resolvedLanguage: "ca-ES-valencia",
      language: "ca-ES-valencia",
    },
  }),
}));
vi.mock("./VerifiedForm", async () => {
  const { createElement } = await import("react");
  return {
    VerifiedForm: ({ children, ...props }: Record<string, unknown>) =>
      createElement("form", props, children as never),
  };
});
vi.mock("./ui/button", async () => {
  const { createElement } = await import("react");
  return {
    Button: ({ children, ...props }: Record<string, unknown>) =>
      createElement("button", props, children as never),
  };
});

const t = ((key: string) => key) as TFunction;
const workerDraft: ManagedUserFormDraft = {
  email: "worker@example.com",
  name: "Worker Example",
  role: "trainer",
};

function fields(input: {
  owner: boolean;
  invitationRole?: "member" | "worker";
  user?: User | null;
  draft?: ManagedUserFormDraft;
}) {
  return renderToStaticMarkup(
    createElement(ManagedUserFormFields, {
      user: input.user,
      invitationRole: input.invitationRole ?? "worker",
      isFacilityOwner: input.owner,
      loading: false,
      draft: input.draft ?? workerDraft,
      t,
      onChange: vi.fn(),
    }),
  );
}

describe("managed-user invitation form markup and payload", () => {
  it("exposes administrator access only to facility owners", () => {
    const owner = fields({ owner: true });
    const administrator = fields({ owner: false });

    expect(owner).toContain('value="trainer"');
    expect(owner).toContain('value="admin"');
    expect(owner).toContain("roles.admin");
    expect(administrator).toContain('value="trainer"');
    expect(administrator).not.toContain('value="admin"');
    expect(administrator).not.toContain("roles.admin");
  });

  it("keeps member affiliation separate from workforce access", () => {
    const markup = fields({
      owner: true,
      invitationRole: "member",
      draft: { ...workerDraft, role: "member" },
    });

    expect(markup).not.toContain('name="managed-user-role"');
    expect(markup).not.toContain("roles.admin");
  });

  it("keeps editing separate from invitation and preserves the email note", () => {
    const user: User = {
      id: "managed-user",
      email: workerDraft.email,
      name: workerDraft.name,
      role: "trainer",
      roles: ["trainer"],
      facilityRole: "trainer",
      memberAffiliation: false,
      classPermissions: {},
      createdAt: 1,
    };
    const markup = fields({ owner: true, user });

    expect(markup).toContain("admin.emailChangeRequiresVerification");
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain("admin.invitationSecurityNotice");
    expect(markup).not.toContain('name="managed-user-role"');
  });

  it("renders an accessible, responsive dialog and announces queue errors", () => {
    const markup = renderToStaticMarkup(
      createElement(
        ManagedUserFormDialogFrame,
        {
          titleId: "managed-title",
          descriptionId: "managed-description",
          title: "admin.inviteUser",
          description: "admin.invitationSecurityNotice",
          loading: true,
          error: "admin.invitationEmailNotQueued",
          cancelLabel: "common.cancel",
          onClose: vi.fn(),
        },
        createElement("form", null, "form-content"),
      ),
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-labelledby="managed-title"');
    expect(markup).toContain('aria-describedby="managed-description"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("admin.invitationEmailNotQueued");
    expect(markup).toContain("max-h-[calc(100dvh-1.5rem)]");
  });

  it.each(["trainer", "admin"] as const)(
    "submits a canonical %s invitation payload without a password",
    async (role) => {
      const inviteUser = vi.fn().mockResolvedValue({ deliveryQueued: true });
      const updateUser = vi.fn();

      await expect(
        submitManagedUserForm({
          draft: { ...workerDraft, role },
          interfaceLocale: "ca-ES-valencia",
          inviteUser,
          updateUser,
        }),
      ).resolves.toBe("success");
      expect(inviteUser).toHaveBeenCalledWith({
        email: workerDraft.email,
        name: workerDraft.name,
        role,
        locale: "ca-valencia",
      });
      expect(inviteUser.mock.calls[0][0]).not.toHaveProperty("password");
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  it("submits a canonical member-affiliation payload", async () => {
    const inviteUser = vi.fn().mockResolvedValue({ deliveryQueued: true });
    await expect(
      submitManagedUserForm({
        draft: { ...workerDraft, role: "member" },
        interfaceLocale: "eu-ES",
        inviteUser,
        updateUser: vi.fn(),
      }),
    ).resolves.toBe("success");
    expect(inviteUser).toHaveBeenCalledWith({
      email: workerDraft.email,
      name: workerDraft.name,
      role: "member",
      locale: "eu",
    });
  });

  it("updates an existing person without creating an invitation", async () => {
    const inviteUser = vi.fn();
    const updateUser = vi.fn().mockResolvedValue({});
    const user: User = {
      id: "existing-worker",
      email: "existing@example.com",
      name: "Existing Worker",
      role: "trainer",
      roles: ["trainer"],
      facilityRole: "trainer",
      memberAffiliation: false,
      classPermissions: {},
      createdAt: 1,
    };
    await expect(
      submitManagedUserForm({
        user,
        draft: { ...workerDraft, name: "Updated Worker" },
        interfaceLocale: "fr-FR",
        inviteUser,
        updateUser,
      }),
    ).resolves.toBe("success");
    expect(updateUser).toHaveBeenCalledWith("existing-worker", {
      email: workerDraft.email,
      name: "Updated Worker",
    });
    expect(inviteUser).not.toHaveBeenCalled();
  });

  it("keeps the invitation open when its email is not queued", async () => {
    await expect(
      submitManagedUserForm({
        draft: workerDraft,
        interfaceLocale: "fr-FR",
        inviteUser: vi.fn().mockResolvedValue({ deliveryQueued: false }),
        updateUser: vi.fn(),
      }),
    ).resolves.toBe("invitation-email-not-queued");
  });

  it("localizes known invitation errors and hides unknown server text", () => {
    expect(
      formatManagedUserFormError(
        new UserActionError(
          "Only the owner may do this",
          "FACILITY_OWNER_REQUIRED",
        ),
        t,
        "invite",
      ),
    ).toBe("admin.invitationOwnerRequired");
    expect(
      formatManagedUserFormError(
        new UserActionError(
          "FACILITY_INVITATION_OPERATION_FAILED",
          "FACILITY_INVITATION_OPERATION_FAILED",
        ),
        t,
        "invite",
      ),
    ).toBe("admin.invitationRequestFailed");
    expect(
      formatManagedUserFormError(
        new Error("Internal English detail"),
        t,
        "invite",
      ),
    ).toBe("admin.invitationRequestFailed");
  });
});

describe("mounted managed-user invitation dialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let launcher: HTMLButtonElement;

  function mount(
    input: {
      onClose?: () => void;
      onSuccess?: () => void;
    } = {},
  ) {
    const onClose = vi.fn(input.onClose);
    const onSuccess = vi.fn(input.onSuccess);
    act(() => {
      root.render(
        createElement(UserForm, {
          onClose,
          onSuccess,
          invitationRole: "worker",
        }),
      );
    });
    act(() => vi.runOnlyPendingTimers());
    return { onClose, onSuccess };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) =>
      window.clearTimeout(id),
    );
    formMocks.inviteUser.mockReset();
    formMocks.updateUser.mockReset();
    formMocks.currentUser = { facility: { role: "owner" } };
    launcher = document.createElement("button");
    launcher.textContent = "Open form";
    document.body.append(launcher);
    launcher.focus();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    launcher.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("focuses the name, traps Tab, closes with Escape/backdrop and restores focus", () => {
    const { onClose } = mount();
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const name =
      container.querySelector<HTMLInputElement>("#managed-user-name")!;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
      ),
    );
    const first = focusable[0];
    const last = focusable.at(-1)!;

    expect(document.activeElement).toBe(name);
    last.focus();
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(first);
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(last);

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();
    act(() =>
      dialog.parentElement!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      ),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    expect(document.activeElement).toBe(launcher);
    root = createRoot(container);
  });

  it("blocks every close path while submitting and succeeds once", async () => {
    let resolveInvitation!: (value: { deliveryQueued: boolean }) => void;
    formMocks.inviteUser.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInvitation = resolve;
        }),
    );
    const { onClose, onSuccess } = mount();
    const form = container.querySelector("form")!;
    const initialDialog =
      container.querySelector<HTMLElement>('[role="dialog"]')!;
    const initialClose = initialDialog.querySelector<HTMLButtonElement>(
      'button[aria-label="common.cancel"]',
    )!;
    const initialFooterCancel = Array.from(
      initialDialog.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "common.cancel")!;

    act(() => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      initialDialog.parentElement!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      );
      initialClose.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      initialFooterCancel.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => Promise.resolve());
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="common.cancel"]',
    )!;
    expect(dialog.getAttribute("aria-busy")).toBe("true");
    expect(close.disabled).toBe(true);

    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    act(() =>
      dialog.parentElement!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true }),
      ),
    );
    act(() => close.click());
    const footerCancel = Array.from(
      dialog.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "common.cancel")!;
    act(() => footerCancel.click());
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      resolveInvitation({ deliveryQueued: true });
      await Promise.resolve();
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("wires deliveryQueued=false and rejected requests to localized alerts", async () => {
    formMocks.inviteUser.mockResolvedValueOnce({ deliveryQueued: false });
    const { onSuccess } = mount();
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "admin.invitationEmailNotQueued",
    );
    expect(onSuccess).not.toHaveBeenCalled();

    act(() => root.unmount());
    root = createRoot(container);
    formMocks.inviteUser.mockRejectedValueOnce(
      new UserActionError("Internal owner detail", "FACILITY_OWNER_REQUIRED"),
    );
    mount();
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "admin.invitationOwnerRequired",
    );
    expect(container.textContent).not.toContain("Internal owner detail");
  });
});
