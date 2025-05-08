let map = L.map('map').setView([39.5, -98.35], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let markers = [];
let totalCO2Saved = 0;
const yearSlider = document.getElementById("yearRange");
const yearLabel = document.getElementById("yearLabel");
const co2Display = document.getElementById("co2");

// Track which plants are "converted" by their ID
let convertedPlants = {};

function getColor(type, converted) {
  if (converted) return 'green';
  switch (type) {
    case 'Coal': return 'black';
    case 'Natural Gas': return 'orange';
    case 'Nuclear': return 'purple';
    case 'Hydro': return 'blue';
    case 'Wind': return 'green';
    case 'Solar': return 'yellow';
    default: return 'gray';
  }
}

function clearMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers = [];
}

function loadYear(year) {
  clearMarkers();
  yearLabel.textContent = year;
  totalCO2Saved = 0;
  co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;

  fetch(`plants_${year}.json`)
    .then(res => res.json())
    .then(data => {
      data.forEach(plant => {
        const id = plant.id;
        const converted = convertedPlants[id] || false;

        const marker = L.circleMarker([plant.lat, plant.lng], {
          color: getColor(plant.type, converted),
          radius: 7,
          fillOpacity: 0.85
        }).addTo(map);

        marker.bindPopup(`${plant.name}<br>Type: ${plant.type}`);

        marker.on('click', () => {
          if (!convertedPlants[id]) {
            convertedPlants[id] = true;
            marker.setStyle({ color: getColor(plant.type, true) });
            // Assume 1 million tons of CO2 per plant as placeholder
            totalCO2Saved += 1_000_000;
            co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
          }
        });

        markers.push(marker);
      });
    });
}

// Initialize
loadYear(parseInt(yearSlider.value));

yearSlider.addEventListener("input", () => {
  const selectedYear = parseInt(yearSlider.value);
  loadYear(selectedYear);
});
