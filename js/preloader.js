(function () {
  try {
    var t = localStorage.getItem('vibe-theme');
    if (t === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  } catch (e) {}

  // If user opened directly via file://, show banner and offer redirect to http://localhost:3000
  // to eliminate YouTube Error 153 (YouTube blocks media playback on file:// protocol)
  if (window.location.protocol === 'file:') {
    // This script runs in <head>, so wait until the banner exists in the document body.
    var showBanner = function () {
      var banner = document.getElementById('file-protocol-banner');
      if (banner) banner.style.display = 'block';
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner, { once: true });
    } else {
      showBanner();
    }

    fetch('http://127.0.0.1:3000/api/songs', { mode: 'cors' })
      .then(function(res) {
        if (res.ok && confirm('YouTube blocks playback on file:// protocol. Redirect to http://localhost:3000?')) {
          window.location.replace('http://localhost:3000');
        }
      })
      .catch(function() {});
  }
})();
