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
    
    // Reset CO2 counter when changing years if no plants have been converted
    if (!Object.keys(convertedPlants).length) {
        totalCO2Saved = 0;
    }
    
    co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
    
    // Log the file we're trying to load
    console.log(`Attempting to load: plants_${year}.json`);
    
    // Try to fetch the actual data
    fetch(`plants_${year}.json`)
        .then(res => {
            if (!res.ok) {
                throw new Error(`Failed to fetch plants_${year}.json: ${res.status} ${res.statusText}`);
            }
            console.log(`Successfully fetched plants_${year}.json`);
            return res.json();
        })
        .then(data => {
            console.log(`Loaded ${data.length} plants from JSON file`);
            
            // Sort plants by type
            const sortedPlants = data.sort((a, b) => a.type.localeCompare(b.type));
            
            // Count plants by type for debugging
            const typeCounts = {};
            sortedPlants.forEach(plant => {
                typeCounts[plant.type] = (typeCounts[plant.type] || 0) + 1;
            });
            console.log("Plants by type:", typeCounts);
            
            // Process and display each plant
            sortedPlants.forEach(plant => {
                const id = plant.id;
                const converted = convertedPlants[id] || false;
                const type = plant.type;
                
                // Validate coordinates
                if (!plant.lat || !plant.lng) {
                    console.warn(`Plant ${plant.id} (${plant.name}) is missing coordinates`);
                    return; // Skip this plant
                }
                
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
            
            console.log(`Added ${markers.length} markers to the map`);
        })
        .catch(error => {
            console.error("Error loading plant data:", error);
            
            // Alert the user about the error
            alert(`Error loading plant data for year ${year}. Please check your file structure and try again. 
            
The application expects a file named "plants_${year}.json" with the following structure:
[
  { 
    "id": 1, 
    "name": "Plant Name", 
    "type": "Coal", 
    "lat": 41.5, 
    "lng": -81.7 
  },
  ...
]`);
        });
}

// Check if JSON files exist and provide guidance
function checkJsonFiles() {
    // Check if the first JSON file exists
    fetch('plants_2023.json')
        .then(res => {
            if (!res.ok) {
                throw new Error('JSON file not found');
            }
            return res.json();
        })
        .then(data => {
            console.log(`Found plants_2023.json with ${data.length} plants.`);
        })
        .catch(error => {
            console.error('Error checking JSON files:', error);
            
            // Show more detailed error message
            const errorMsg = document.createElement('div');
            errorMsg.style.backgroundColor = '#ffecec';
            errorMsg.style.color = '#f44336';
            errorMsg.style.padding = '15px';
            errorMsg.style.margin = '15px';
            errorMsg.style.borderRadius = '5px';
            errorMsg.style.border = '1px solid #f44336';
            
            errorMsg.innerHTML = `
                <h3>Data Files Not Found</h3>
                <p>The application couldn't find the required data files. 
                Please make sure you have the following files in the same directory as your HTML file:</p>
                <ul>
                    <li>plants_2014.json</li>
                    <li>plants_2015.json</li>
                    <li>...</li>
                    <li>plants_2023.json</li>
                </ul>
                <p>Each file should contain an array of power plant objects with the following structure:</p>
                <pre>[
  { 
    "id": 1, 
    "name": "Plant Name", 
    "type": "Coal", 
    "lat": 41.5, 
    "lng": -81.7 
  },
  ...
]</pre>
            `;
            
            document.body.insertBefore(errorMsg, document.getElementById('map'));
        });
}

// Run initial checks
checkJsonFiles();

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