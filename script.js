// Initialize the map centered on the US
let map = L.map('map').setView([39.5, -98.35], 5);

// Add the OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Array to store markers for easy removal when changing years
let markers = [];
let totalCO2Saved = 0;

// Get DOM elements
const yearSlider = document.getElementById("yearRange");
const yearLabel = document.getElementById("yearLabel");
const co2Display = document.getElementById("co2");

// Track which plants are "converted" by their ID
let convertedPlants = {};

// Plant type colors
const plantTypeColors = {
    'Coal': 'black',
    'Natural Gas': 'orange',
    'Nuclear': 'purple',
    'Hydro': 'blue',
    'Wind': 'lightgreen',
    'Solar': 'yellow',
    'Other': 'gray',
    'Converted': 'green'
};

// Function to get color based on plant type and conversion status
function getColor(type, converted) {
    if (converted) return plantTypeColors['Converted'];
    return plantTypeColors[type] || plantTypeColors['Other'];
}

// Function to clear all markers from the map
function clearMarkers() {
    markers.forEach(m => map.removeLayer(m));
    markers = [];
}

// Create marker layer groups for each plant type
let plantLayerGroups = {};
Object.keys(plantTypeColors).forEach(type => {
    plantLayerGroups[type] = L.layerGroup().addTo(map);
});

// Function to load plant data for a specific year
function loadYear(year) {
    clearMarkers();
    yearLabel.textContent = year;
    
    // Reset CO2 counter when changing years
    if (!Object.keys(convertedPlants).length) {
        totalCO2Saved = 0;
    }
    
    co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
    
    fetch(`plants_${year}.json`)
        .then(res => res.json())
        .then(data => {
            // Clear all layer groups
            Object.values(plantLayerGroups).forEach(group => group.clearLayers());
            
            // Sort plants by type for better organization
            const sortedPlants = data.sort((a, b) => a.type.localeCompare(b.type));
            
            sortedPlants.forEach(plant => {
                const id = plant.id;
                const converted = convertedPlants[id] || false;
                const type = plant.type;
                
                // Create marker with appropriate styling
                const marker = L.circleMarker([plant.lat, plant.lng], {
                    color: 'white',
                    weight: 1,
                    fillColor: getColor(type, converted),
                    radius: 7,
                    fillOpacity: 0.85
                });
                
                // Add popup with plant info
                marker.bindPopup(`
                    <strong>${plant.name}</strong><br>
                    Type: ${plant.type}<br>
                    Status: ${converted ? 'Converted to Clean Energy' : 'Original Power Source'}<br>
                    Location: ${plant.lat.toFixed(4)}, ${plant.lng.toFixed(4)}
                `);
                
                // Add click event for conversion
                marker.on('click', () => {
                    if (!convertedPlants[id]) {
                        convertedPlants[id] = true;
                        marker.setStyle({ fillColor: plantTypeColors['Converted'] });
                        
                        // Adjust CO2 savings based on plant type
                        let co2Factor;
                        switch(type) {
                            case 'Coal': co2Factor = 2_000_000; break;
                            case 'Natural Gas': co2Factor = 1_000_000; break;
                            default: co2Factor = 500_000;
                        }
                        
                        totalCO2Saved += co2Factor;
                        co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
                    }
                });
                
                // Add to the appropriate layer group
                const layerKey = converted ? 'Converted' : type;
                marker.addTo(plantLayerGroups[layerKey] || plantLayerGroups['Other']);
                
                // Store marker reference
                markers.push(marker);
            });
        })
        .catch(error => {
            console.error("Error loading plant data:", error);
        });
}

// Initialize map with starting year
loadYear(parseInt(yearSlider.value));

// Add event listener for year slider
yearSlider.addEventListener("input", () => {
    const selectedYear = parseInt(yearSlider.value);
    loadYear(selectedYear);
});

// Add legend to map
const legend = L.control({ position: "bottomright" });
legend.onAdd = function () {
    const div = L.DomUtil.create("div", "legend");
    
    div.innerHTML += "<strong>Plant Types</strong><br>";
    
    // Add entries for each plant type
    Object.entries(plantTypeColors).forEach(([type, color]) => {
        if (type !== 'Converted') {
            div.innerHTML += `<i style="background:${color}"></i>${type}<br>`;
        }
    });
    
    // Add converted plant entry at the end
    div.innerHTML += "<i style=\"background:green\"></i>Converted Plant<br>";
    
    return div;
};
legend.addTo(map);