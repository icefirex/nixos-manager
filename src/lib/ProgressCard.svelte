<script>
  import Icon from "./Icon.svelte";

  let { title, subtitle, percentage, eta, currentStep, steps } = $props();

  function getStepStatus(index) {
    if (index < currentStep) return "completed";
    if (index === currentStep) return "active";
    return "";
  }
</script>

<div class="progress-card">
  <div class="progress-header">
    <div class="progress-info">
      <h3>{title}</h3>
      <span>{subtitle}</span>
    </div>
    <div class="progress-stats">
      <div class="progress-percentage">{percentage}%</div>
      <div class="progress-eta">ETA: {eta}</div>
    </div>
  </div>

  <div class="progress-visual">
    <div class="progress-bar-container">
      <div class="progress-bar-fill" style="width: {percentage}%">
        <span class="progress-bar-text">Building derivations...</span>
      </div>
    </div>
  </div>

  <div class="steps-container">
    <div class="steps-line">
      <div
        class="steps-line-fill"
        style="width: {(currentStep / (steps.length - 1)) * 100}%"
      ></div>
    </div>

    {#each steps as step, i}
      <div class="step {getStepStatus(i)}">
        <div class="step-icon">
          {#if i < currentStep}
            <Icon name="Check" size={14} />
          {:else}
            {i + 1}
          {/if}
        </div>
        <span class="step-label">{step}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .progress-card {
    background: rgba(24, 24, 37, 0.95);
    border: 1px solid rgba(49, 50, 68, 0.5);
    border-radius: 20px;
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  /* Subtle animated glow behind progress */
  .progress-card::after {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(
      circle,
      rgba(137, 180, 250, 0.05) 0%,
      transparent 50%
    );
    transform: translate(-50%, -50%);
    animation: progressGlow 4s ease-in-out infinite;
    pointer-events: none;
  }

  @keyframes progressGlow {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
  }

  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    position: relative;
    z-index: 1;
  }

  .progress-info h3 {
    font-size: 16px;
    font-weight: 600;
    color: #cdd6f4;
    margin-bottom: 4px;
  }

  .progress-info span {
    font-size: 12px;
    color: #6c7086;
  }

  .progress-stats {
    text-align: right;
  }

  .progress-percentage {
    font-size: 36px;
    font-weight: 700;
    background: linear-gradient(135deg, #89b4fa 0%, #a6e3a1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    line-height: 1;
    filter: drop-shadow(0 2px 4px rgba(137, 180, 250, 0.3));
  }

  .progress-eta {
    font-size: 11px;
    color: #6c7086;
    margin-top: 4px;
  }

  .progress-visual {
    margin-bottom: 24px;
    position: relative;
    z-index: 1;
  }

  .progress-bar-container {
    background: rgba(49, 50, 68, 0.6);
    border-radius: 14px;
    height: 28px;
    overflow: hidden;
    position: relative;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .progress-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #89b4fa 0%, #94e2d5 50%, #a6e3a1 100%);
    border-radius: 14px;
    position: relative;
    transition: width 0.5s ease;
    box-shadow: 0 0 20px rgba(137, 180, 250, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
  }

  .progress-bar-fill::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.4) 50%,
      transparent 100%
    );
    animation: shimmer 2s infinite;
  }

  /* Liquid bubble effect */
  .progress-bar-fill::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 8px;
    right: 8px;
    height: 8px;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.3) 0%,
      transparent 100%
    );
    border-radius: 10px;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(200%);
    }
  }

  .progress-bar-text {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    font-weight: 600;
    color: #1e1e2e;
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.2);
  }

  .steps-container {
    display: flex;
    justify-content: space-between;
    position: relative;
    padding: 0 20px;
    z-index: 1;
  }

  .steps-line {
    position: absolute;
    top: 20px;
    left: 60px;
    right: 60px;
    height: 4px;
    background: rgba(49, 50, 68, 0.6);
    border-radius: 2px;
    overflow: hidden;
  }

  .steps-line-fill {
    height: 100%;
    background: linear-gradient(90deg, #a6e3a1 0%, #89b4fa 100%);
    border-radius: 2px;
    transition: width 0.5s ease;
    box-shadow: 0 0 12px rgba(137, 180, 250, 0.5);
  }

  .step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    position: relative;
    z-index: 1;
  }

  .step-icon {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    background: rgba(49, 50, 68, 0.95);
    border: 3px solid rgba(49, 50, 68, 0.8);
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .step.completed .step-icon {
    background: linear-gradient(135deg, #a6e3a1 0%, #94e2d5 100%);
    border-color: #a6e3a1;
    color: #1e1e2e;
    box-shadow: 0 0 20px rgba(166, 227, 161, 0.4);
  }

  .step.active .step-icon {
    background: linear-gradient(135deg, #89b4fa 0%, #b4befe 100%);
    border-color: #89b4fa;
    color: #1e1e2e;
    animation: pulse 2s infinite;
    box-shadow: 0 0 24px rgba(137, 180, 250, 0.5);
  }

  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 0 0 rgba(137, 180, 250, 0.5),
        0 0 20px rgba(137, 180, 250, 0.3);
    }
    50% {
      box-shadow: 0 0 0 12px rgba(137, 180, 250, 0),
        0 0 30px rgba(137, 180, 250, 0.5);
    }
  }

  .step-label {
    font-size: 11px;
    color: #6c7086;
    font-weight: 500;
  }

  .step.completed .step-label,
  .step.active .step-label {
    color: #cdd6f4;
  }
</style>
