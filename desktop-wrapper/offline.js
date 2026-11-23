const retry = document.getElementById("retry");
retry?.addEventListener("click", () => {
  if (!window.mobflowDesktop?.retryConnection) return;
  retry.disabled = true;
  retry.textContent = "Conectando...";
  window.mobflowDesktop.retryConnection();
  window.setTimeout(() => {
    if (retry.isConnected) {
      retry.disabled = false;
      retry.textContent = "Tentar novamente";
    }
  }, 8000);
});
