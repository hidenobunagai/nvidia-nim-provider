const mockAppendLine = jest.fn();
const mockCreateOutputChannel = jest.fn(() => ({
  appendLine: mockAppendLine,
  show: jest.fn(),
  dispose: jest.fn(),
}));

jest.mock("vscode", () => ({
  window: {
    createOutputChannel: mockCreateOutputChannel,
  },
}));

describe("output-channel", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete process.env.NVIDIA_NIM_DEBUG;
  });

  it("creates a NVIDIA NIM output channel and reads the NVIDIA debug env var", async () => {
    process.env.NVIDIA_NIM_DEBUG = "1";

    const { debugEnabled, debugLog, getOutputChannel } = await import("../src/output-channel");

    expect(debugEnabled()).toBe(true);

    getOutputChannel();
    debugLog("activate", "ready");

    expect(mockCreateOutputChannel).toHaveBeenCalledWith("NVIDIA NIM");
    expect(mockAppendLine).toHaveBeenCalledWith("[NVIDIA NIM Debug] activate: ready");
  });
});
