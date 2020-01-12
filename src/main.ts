import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { type } from 'os';
import { prependEach, nonEmptySplit } from './strings';

function home() {
  if (type() == "Darwin") {
    return "/Users/runner";
  } else {
    return "/home/runner";
  }
}

async function run() {
  try {
    // inputs
    const file = core.getInput('file');
    const skipNixBuild = core.getInput('skipNixBuild');
    const attributes = core.getInput('attributes');
    const nixBuildArgs = core.getInput('nixBuildArgs');
    const name = core.getInput('name', { required: true });
    const signingKey = core.getInput('signingKey');
    const authToken = core.getInput('authToken')
    const cachixExecutable = "/nix/var/nix/profiles/per-user/runner/profile/bin/cachix";

    core.startGroup('Installing Cachix')
    await exec.exec('nix-env', ['-iA', 'cachix', '-f', 'https://cachix.org/api/v1/install']);
    core.endGroup()

    // for private caches
    if (authToken !== "") {
      await exec.exec(cachixExecutable, ['authtoken', authToken]);
    }

    core.startGroup(`Cachix: using ` + name);
    await exec.exec('cachix', ['use', name]);
    core.endGroup();

    if (signingKey !== "") {
      core.startGroup('Cachix: Configuring push');
      // needed to discover auth token
      await exec.exec("sudo", ["sh", "-c", `echo export HOME=${home()} > /etc/nix/cachix-push.sh`]);
      await exec.exec("sudo", ["sh", "-c", `echo export CACHIX_SIGNING_KEY=${signingKey} >> /etc/nix/cachix-push.sh`]);
      // needed to for nix-store
      await exec.exec("sudo", ["sh", "-c", `echo export PATH=\\$PATH:/nix/var/nix/profiles/default/bin:/nix/var/nix/profiles/per-user/runner/profile/bin >> /etc/nix/cachix-push.sh`]);
      await exec.exec("sudo", ["sh", "-c", `echo ${cachixExecutable} push ${name} \\$OUT_PATHS >> /etc/nix/cachix-push.sh`]);
      await exec.exec("sudo", ["sh", "-c", `chmod +x /etc/nix/cachix-push.sh`]);
      // enable post-build-hook
      await exec.exec("sudo", ["sh", "-c", `echo post-build-hook = /etc/nix/cachix-push.sh >> /etc/nix/nix.conf`]);
      core.exportVariable('CACHIX_SIGNING_KEY', signingKey);

      // Ignore reloading failures as Nix might be installed in single-user mode (install-nix-action version 5 or lower)
      const options = { ignoreReturnCode: true };
      // Reload nix-daemon
      if (type() == "Darwin") {
        // kickstart awaits nix-daemon to get up again
        await exec.exec("sudo", ["launchctl", "kickstart", "-k", "system/org.nixos.nix-daemon"], options);
      } else {
        await exec.exec("sudo", ["pkill", "-HUP", "nix-daemon"], options);
      }

      core.endGroup();
    }
    if (skipNixBuild !== 'true') {
      core.startGroup(`Invoking nix-build`);
      let paths = '';
      const options = {
        listeners: {
          stdout: (data: Buffer) => {
            paths += data.toString();
          },
        }
      };
      const args = prependEach('-A', nonEmptySplit(attributes, /\s+/)).concat([file || "default.nix"]);
      const additionalArgs = nonEmptySplit(nixBuildArgs, /\s+/);
      await exec.exec('nix-build', additionalArgs.concat(args), options);
      core.endGroup()
    }
  } catch (error) {
    core.setFailed(`Action failed with error: ${error}`);
    throw (error);
  }
}

run();
