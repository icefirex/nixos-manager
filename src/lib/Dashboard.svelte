<script>
  import ActionCard from "./ActionCard.svelte";
  import ProgressCard from "./ProgressCard.svelte";
  import SidePanel from "./SidePanel.svelte";

  let { systemInfo = {} } = $props();

  let updateInputs = $state(false);

  let isBuilding = $state(false);
  let currentAction = $state(null);
  let buildError = $state(null);

  // Progress tracking
  let buildProgress = $state({
    title: "",
    subtitle: "",
    percentage: 0,
    eta: "Calculating...",
    currentStep: 0,
    steps: ["Validate", "Stage", "Fetch", "Build", "Activate"],
  });

  // Listen for build output to update progress
  $effect(() => {
    const cleanup = window.electronAPI.onBuildOutput((data) => {
      updateProgressFromOutput(data);
    });
    return cleanup;
  });

  // Listen for flake update events from SidePanel
  $effect(() => {
    function handleFlakeUpdateStart(e) {
      const { inputName } = e.detail;
      isBuilding = true;

      buildProgress = {
        title: inputName === 'all' ? 'Updating All Flake Inputs' : `Updating ${inputName}`,
        subtitle: 'nix flake update',
        percentage: 50,
        eta: "Running...",
        currentStep: 2,
        steps: ["Start", "Fetch", "Update", "Complete"],
      };
    }

    function handleFlakeUpdateComplete(e) {
      const { inputName, success, error } = e.detail;
      isBuilding = false;

      if (success) {
        buildProgress.percentage = 100;
        buildProgress.currentStep = 4;
        buildProgress.eta = "Complete!";
      } else {
        buildProgress.eta = "Failed";
        buildError = error;
      }
    }

    window.addEventListener('flake-update-start', handleFlakeUpdateStart);
    window.addEventListener('flake-update-complete', handleFlakeUpdateComplete);

    return () => {
      window.removeEventListener('flake-update-start', handleFlakeUpdateStart);
      window.removeEventListener('flake-update-complete', handleFlakeUpdateComplete);
    };
  });

  function updateProgressFromOutput(data) {
    const lowerData = data.toLowerCase();

    // Detect stages from nixos-rebuild-wrapper output
    if (lowerData.includes('validation passed') || lowerData.includes('validating')) {
      buildProgress.currentStep = 1;
      buildProgress.percentage = 20;
    }
    if (lowerData.includes('staging') || lowerData.includes('staged')) {
      buildProgress.currentStep = 2;
      buildProgress.percentage = 35;
    }
    if (lowerData.includes('checking for remote') || lowerData.includes('fetching') || lowerData.includes('fetch')) {
      buildProgress.currentStep = 2;
      buildProgress.percentage = 45;
    }
    if (lowerData.includes('building') || lowerData.includes('these derivations will be built')) {
      buildProgress.currentStep = 3;
      buildProgress.percentage = 55;
    }
    if (lowerData.includes('activating') || lowerData.includes('switch-to-configuration')) {
      buildProgress.currentStep = 4;
      buildProgress.percentage = 85;
    }
    if (lowerData.includes('successfully') || lowerData.includes('finished')) {
      buildProgress.currentStep = 5;
      buildProgress.percentage = 100;
      buildProgress.eta = "Done!";
    }
  }

  function getActionTitle(action) {
    const titles = {
      'switch': 'Switching System Configuration',
      'boot': 'Building for Next Boot',
      'test': 'Testing Configuration (Dry Run)',
      'dry-build': 'Evaluating Configuration'
    };
    return titles[action] || 'Building';
  }

  async function handleAction(action) {
    isBuilding = true;
    currentAction = action;
    buildError = null;

    // Reset progress
    buildProgress = {
      title: getActionTitle(action),
      subtitle: systemInfo?.hostname ? `nixos-system-${systemInfo.hostname}` : "nixos-system",
      percentage: 5,
      eta: "Calculating...",
      currentStep: 0,
      steps: ["Validate", "Stage", "Fetch", "Build", "Activate"],
    };

    try {
      await window.electronAPI.nixosRebuild({
        action,
        updateInputs,
      });
      buildProgress.percentage = 100;
      buildProgress.currentStep = 5;
      buildProgress.eta = "Complete!";
    } catch (e) {
      console.error("Rebuild failed:", e);
      buildError = e.message || "Build failed";
      buildProgress.eta = "Failed";
    } finally {
      // Brief pause so the user sees the completed/failed state
      await new Promise(r => setTimeout(r, 2000));
      isBuilding = false;
      currentAction = null;
    }
  }
</script>

<div class="dashboard">
  <div class="actions-section">
    <div class="section-title">Quick Actions</div>
    <div class="action-grid">
      <ActionCard
        type="switch"
        icon="Zap"
        title="Switch"
        description="Apply immediately"
        onclick={() => handleAction("switch")}
        disabled={isBuilding}
      />
      <ActionCard
        type="boot"
        icon="Rocket"
        title="Boot"
        description="Apply on reboot"
        onclick={() => handleAction("boot")}
        disabled={isBuilding}
      />
      <ActionCard
        type="test"
        icon="FlaskConical"
        title="Test"
        description="Dry run preview"
        onclick={() => handleAction("test")}
        disabled={isBuilding}
      />
      <ActionCard
        type="eval"
        icon="CheckCircle"
        title="Evaluate"
        description="Validate config"
        onclick={() => handleAction("dry-build")}
        disabled={isBuilding}
      />
    </div>

    <div class="options-row">
      <label class="toggle-item">
        <span class="toggle-label">Update flake inputs</span>
        <button
          class="toggle-switch"
          class:active={updateInputs}
          disabled={isBuilding}
          onclick={() => updateInputs = !updateInputs}
        >
          <span class="toggle-knob"></span>
        </button>
      </label>
    </div>

    {#if isBuilding}
      <div class="progress-section">
        <ProgressCard {...buildProgress} />
      </div>
    {/if}
  </div>

  <SidePanel />
</div>

<style>
  .dashboard {
    flex: 1;
    padding: 24px;
    display: grid;
    grid-template-columns: 2fr 1fr;
    grid-template-rows: auto 1fr;
    gap: 20px;
    overflow-y: auto;
  }

  .actions-section {
    grid-column: 1;
  }

  .section-title {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6c7086;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title::after {
    content: "";
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(49, 50, 68, 0.8), transparent);
  }

  .action-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  .options-row {
    display: flex;
    gap: 16px;
    margin-top: 16px;
    padding: 12px 16px;
    background: rgba(24, 24, 37, 0.9);
    border-radius: 12px;
    border: 1px solid rgba(49, 50, 68, 0.5);
  }

  .toggle-item {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .toggle-label {
    font-size: 12px;
    color: #a6adc8;
    transition: color 0.2s;
  }

  .toggle-item:hover .toggle-label {
    color: #cdd6f4;
  }

  .toggle-switch {
    position: relative;
    width: 36px;
    height: 20px;
    background: rgba(49, 50, 68, 0.8);
    border: 1px solid rgba(69, 71, 90, 0.5);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.25s ease;
    padding: 0;
  }

  .toggle-switch:hover:not(:disabled) {
    border-color: rgba(137, 180, 250, 0.5);
  }

  .toggle-switch.active {
    background: rgba(137, 180, 250, 0.3);
    border-color: rgba(137, 180, 250, 0.6);
  }

  .toggle-switch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toggle-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    background: #6c7086;
    border-radius: 50%;
    transition: all 0.25s ease;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .toggle-switch.active .toggle-knob {
    left: 18px;
    background: #89b4fa;
    box-shadow: 0 0 8px rgba(137, 180, 250, 0.5);
  }

  .progress-section {
    margin-top: 20px;
  }
</style>
