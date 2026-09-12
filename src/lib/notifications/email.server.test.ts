import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function ResendMock() {
    return { emails: { send: sendMock } };
  }),
}));

const { EmailService, EmailNotConfiguredError } = await import("./email.server");

describe("EmailService.send", () => {
  const originalApiKey = process.env.RESEND_API_KEY;

  beforeEach(() => {
    sendMock.mockReset();
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalApiKey;
    }
  });

  it("throws EmailNotConfiguredError when RESEND_API_KEY is not set", async () => {
    delete process.env.RESEND_API_KEY;

    await expect(
      EmailService.send({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t" }),
    ).rejects.toBeInstanceOf(EmailNotConfiguredError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("sends via Resend when configured", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    sendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await EmailService.send({
      to: "merchant@example.com",
      subject: "Hello",
      html: "<p>Hi</p>",
      text: "Hi",
    });

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "merchant@example.com", subject: "Hello" }),
    );
  });

  it("throws when Resend returns an error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    sendMock.mockResolvedValue({ data: null, error: { message: "invalid domain", name: "validation_error", statusCode: 422 } });

    await expect(
      EmailService.send({ to: "a@example.com", subject: "s", html: "<p>h</p>", text: "t" }),
    ).rejects.toThrow(/invalid domain/);
  });
});
