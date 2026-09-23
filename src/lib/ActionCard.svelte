<script>
  import Icon from "./Icon.svelte";

  let { type, icon, title, description, onclick, disabled = false } = $props();
</script>

<button class="action-card {type}" class:disabled {onclick} {disabled}>
  <div class="icon"><Icon name={icon} size={24} /></div>
  <h4>{title}</h4>
  <p>{description}</p>
</button>

<style>
  .action-card {
    background: rgba(var(--base-rgb), 0.9);
    border: 1px solid rgba(var(--surface0-rgb), 0.5);
    border-radius: 16px;
    padding: 20px 16px;
    cursor: pointer;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    text-align: center;
    position: relative;
    overflow: hidden;
    color: inherit;
  }

  /* Glass shine effect */
  .action-card::before {
    content: "";
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(var(--white-rgb), 0.05) 50%,
      transparent 100%
    );
    transition: left 0.5s;
  }

  .action-card:hover::before {
    left: 100%;
  }

  .action-card:hover {
    transform: translateY(-6px) scale(1.02);
    border-color: rgba(var(--blue-rgb), 0.5);
    box-shadow: 0 16px 40px rgba(var(--black-rgb), 0.3),
      0 0 30px rgba(var(--blue-rgb), 0.1);
  }

  .icon {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 12px;
  }

  .action-card.switch .icon {
    background: rgba(var(--green-rgb), 0.2);
    box-shadow: 0 4px 12px rgba(var(--green-rgb), 0.2);
  }

  .action-card.boot .icon {
    background: rgba(var(--blue-rgb), 0.2);
    box-shadow: 0 4px 12px rgba(var(--blue-rgb), 0.2);
  }

  .action-card.test .icon {
    background: rgba(var(--yellow-rgb), 0.2);
    box-shadow: 0 4px 12px rgba(var(--yellow-rgb), 0.2);
  }

  .action-card.eval .icon {
    background: rgba(var(--mauve-rgb), 0.2);
    box-shadow: 0 4px 12px rgba(var(--mauve-rgb), 0.2);
  }

  /* Colored border glow on hover */
  .action-card.switch:hover {
    border-color: rgba(var(--green-rgb), 0.5);
    box-shadow: 0 16px 40px rgba(var(--black-rgb), 0.3),
      0 0 30px rgba(var(--green-rgb), 0.2);
  }

  .action-card.boot:hover {
    border-color: rgba(var(--blue-rgb), 0.5);
    box-shadow: 0 16px 40px rgba(var(--black-rgb), 0.3), 0 0 30px rgba(var(--blue-rgb), 0.2);
  }

  .action-card.test:hover {
    border-color: rgba(var(--yellow-rgb), 0.5);
    box-shadow: 0 16px 40px rgba(var(--black-rgb), 0.3),
      0 0 30px rgba(var(--yellow-rgb), 0.2);
  }

  .action-card.eval:hover {
    border-color: rgba(var(--mauve-rgb), 0.5);
    box-shadow: 0 16px 40px rgba(var(--black-rgb), 0.3),
      0 0 30px rgba(var(--mauve-rgb), 0.2);
  }

  h4 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    margin-bottom: 4px;
  }

  p {
    font-size: 10px;
    color: var(--overlay0);
  }

  .action-card.disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }

  .action-card.disabled:hover {
    transform: none;
    box-shadow: none;
  }
</style>
