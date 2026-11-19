cask "harness-control" do
  version "0.1.0"
  sha256 :no_check

  url "https://github.com/jcn/harness-control/releases/download/v#{version}/harness-control_#{version}_aarch64.dmg"
  name "harness-control"
  desc "Desktop dashboard for AI coding harness skills, provenance, and token telemetry"
  homepage "https://github.com/jcn/harness-control"

  app "harness-control.app"
end
