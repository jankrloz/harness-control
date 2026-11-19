class HarnessControl < Formula
  desc "Unified visibility dashboard and orchestration wrapper across AI coding harnesses"
  homepage "https://github.com/jankrloz/harness-control"
  version "0.1.0"
  license "MIT"

  depends_on "node"

  def install
    libexec.install Dir["*"]
    (bin/"harness-control").write_env_script libexec/"packages/cli/dist/bin.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
    (bin/"harness-controld").write_env_script libexec/"packages/server/dist/daemon.js", PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match "0.1.0", shell_output("#{bin}/harness-control --version")
  end
end
