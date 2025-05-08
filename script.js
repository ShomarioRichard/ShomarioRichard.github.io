let map = L.map('map').setView([39.5, -98.35], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let totalCO2Saved = 0;
const yearSlider = document.getElementById("yearRange");
const yearLabel = document.getElementById("yearLabel");
const co2Display = document.getElementById("co2");

fetch('plants.json')
  .then(res => res.json())
  .then(data => {
    data.forEach(plant => {
      const marker = L.circleMarker([plant.lat, plant.lng], {
        color: plant.converted ? 'green' : 'red',
        radius: 8
      }).addTo(map);

      marker.bindPopup(`${plant.name}<br>Type: ${plant.type}<br>CO2: ${plant.co2.toLocaleString()} tons`);

      marker.on('click', () => {
        if (!plant.converted) {
          plant.converted = true;
          plant.year = parseInt(yearSlider.value);
          totalCO2Saved += plant.co2;
          marker.setStyle({ color: 'green' });
          co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
        }
      });
    });
  });

yearSlider.addEventListener("input", () => {
  yearLabel.textContent = yearSlider.value;
});
