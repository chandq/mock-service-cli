document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button');
  button.disabled = true;
  try {
    const response = await fetch('/__api-client/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    location.assign('/');
  } catch (error) {
    document.getElementById('error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
