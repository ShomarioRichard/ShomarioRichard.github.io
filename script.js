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

// Function to load plant data for a specific year
function loadYear(year) {
    clearMarkers();
    yearLabel.textContent = year;
    
    // Reset CO2 counter when changing years
    if (!Object.keys(convertedPlants).length) {
        totalCO2Saved = 0;
    }
    
    co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
    
    // Use a sample data for demonstration since we don't have the actual JSON files
    // In a real scenario, you would use your fetch call
    const sampleData = [
        { id: 1, name: "Coal Plant 1", type: "Coal", lat: 40.7, lng: -74.0 },
        { id: 2, name: "Nuclear Plant 1", type: "Nuclear", lat: 41.8, lng: -87.6 },
        { id: 3, name: "Hydro Plant 1", type: "Hydro", lat: 37.7, lng: -122.4 },
        { id: 4, name: "Wind Farm 1", type: "Wind", lat: 39.1, lng: -94.5 },
        { id: 5, name: "Solar Array 1", type: "Solar", lat: 36.1, lng: -115.1 },
        { id: 6, name: "Natural Gas Plant 1", type: "Natural Gas", lat: 33.7, lng: -84.4 },
        { id: 7, name: "Coal Plant 2", type: "Coal", lat: 39.9, lng: -75.1 },
        { id: 8, name: "Nuclear Plant 2", type: "Nuclear", lat: 34.0, lng: -118.2 }
    ];
    
    // Try to fetch the actual data first
    fetch(`plants_${year}.json`)
        .then(res => res.json())
        .catch(error => {
            console.log("Using sample data instead of fetching JSON:", error);
            return sampleData; // Use sample data if fetch fails
        })
        .then(data => {
            // Sort plants by type for better organization
            const sortedPlants = data.sort((a, b) => a.type.localeCompare(b.type));
            
            sortedPlants.forEach(plant => {
                const id = plant.id;
                const converted = convertedPlants[id] || false;
                const type = plant.type;
                
                // Create marker with appropriate styling - much larger size
                const marker = L.circleMarker([plant.lat, plant.lng], {
                    color: 'white',
                    weight: 2,
                    fillColor: getColor(type, converted),
                    radius: 20,  // Much larger radius
                    fillOpacity: 0.85
                }).addTo(map); // Add directly to map
                
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
                
                // Store marker reference
                markers.push(marker);
            });
        })
        .catch(error => {
            console.error("Error processing plant data:", error);
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

// Debug information - log to console when map is loaded
map.on('load', function() {
    console.log("Map loaded successfully");
});

// Debug information - check if markers are added
console.log("Initial setup complete, markers should be visible");