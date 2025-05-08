// Initialize the map centered on the US
let map = L.map('map').setView([39.5, -98.35], 4);

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

// Define categories for simplifying the many power plant types
const typeCategories = {
    'Coal': ['Conventional Steam Coal'],
    'Natural Gas': ['Natural Gas Fired Combined Cycle', 'Natural Gas Fired Combustion Turbine', 'Natural Gas Steam Turbine'],
    'Nuclear': ['Nuclear'],
    'Hydro': ['Conventional Hydroelectric'],
    'Oil': ['Petroleum Liquids'],
    'Wind': ['Wind'],
    'Solar': ['Solar Photovoltaic', 'Solar Thermal'],
    'Other': [] // Anything else falls here
};

// Reverse mapping to categorize plant types
const typeToCategory = {};
Object.entries(typeCategories).forEach(([category, types]) => {
    types.forEach(type => {
        typeToCategory[type] = category;
    });
});

// Plant type colors
const plantTypeColors = {
    'Coal': '#000000', // Black
    'Natural Gas': '#FFA500', // Orange
    'Nuclear': '#800080', // Purple
    'Hydro': '#0000FF', // Blue
    'Oil': '#8B4513', // Brown
    'Wind': '#90EE90', // Light Green
    'Solar': '#FFFF00', // Yellow
    'Other': '#808080', // Gray
    'Converted': '#008000' // Green
};

// Function to get category from plant type
function getCategory(type) {
    if (!type || type === "NaN" || type === "null") return 'Other';
    
    // Check if type is directly in our mapping
    if (typeToCategory[type]) {
        return typeToCategory[type];
    }
    
    // Try to match by substring
    for (const [category, types] of Object.entries(typeCategories)) {
        if (type.toLowerCase().includes(category.toLowerCase())) {
            return category;
        }
    }
    
    return 'Other';
}

// Function to get color based on plant type and conversion status
function getColor(type, converted) {
    if (converted) return plantTypeColors['Converted'];
    
    const category = getCategory(type);
    return plantTypeColors[category] || plantTypeColors['Other'];
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
            
            // Process and display each plant
            data.forEach(plant => {
                const id = plant.id;
                const converted = convertedPlants[id] || false;
                const type = plant.type;
                
                // Skip plants with invalid coordinates
                if (!plant.lat || !plant.lng || 
                    isNaN(plant.lat) || isNaN(plant.lng)) {
                    console.warn(`Plant ${plant.id} (${plant.name}) has invalid coordinates`);
                    return;
                }
                
                // Get the simplified category
                const category = getCategory(type);
                
                // Create marker with appropriate styling
                const marker = L.circleMarker([plant.lat, plant.lng], {
                    color: 'white',
                    weight: 2,
                    fillColor: getColor(type, converted),
                    radius: 20,
                    fillOpacity: 0.85
                }).addTo(map);
                
                // Add popup with plant info
                marker.bindPopup(`
                    <strong>${plant.name}</strong><br>
                    Location: ${plant.state}<br>
                    Type: ${type || 'Unknown'}<br>
                    Category: ${category}<br>
                    Status: ${converted ? 'Converted to Clean Energy' : 'Original Power Source'}<br>
                    Coordinates: ${plant.lat.toFixed(4)}, ${plant.lng.toFixed(4)}
                `);
                
                // Add click event for conversion
                marker.on('click', () => {
                    if (!convertedPlants[id]) {
                        convertedPlants[id] = true;
                        marker.setStyle({ fillColor: plantTypeColors['Converted'] });
                        
                        // Adjust CO2 savings based on plant type
                        let co2Factor;
                        switch(category) {
                            case 'Coal': co2Factor = 2_000_000; break;
                            case 'Natural Gas': co2Factor = 1_000_000; break;
                            case 'Oil': co2Factor = 1_500_000; break;
                            default: co2Factor = 500_000;
                        }
                        
                        totalCO2Saved += co2Factor;
                        co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
                    }
                });
                
                // Store marker reference
                markers.push(marker);
            });
            
            // Count plants by category for the legend
            const categoryCounts = {};
            Object.keys(plantTypeColors).forEach(category => {
                categoryCounts[category] = 0;
            });
            
            markers.forEach(marker => {
                const popupContent = marker._popup.getContent();
                const categoryMatch = popupContent.match(/Category: (.*?)<br>/);
                if (categoryMatch && categoryMatch[1]) {
                    const category = categoryMatch[1];
                    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                }
            });
            
            console.log(`Added ${markers.length} markers to the map`);
            console.log("Plants by category:", categoryCounts);
            
            // Update the legend with counts
            updateLegend(categoryCounts);
        })
        .catch(error => {
            console.error("Error loading plant data:", error);
            
            // Alert the user about the error in a more user-friendly way
            const errorContainer = document.createElement('div');
            errorContainer.style.backgroundColor = '#ffecec';
            errorContainer.style.color = '#f44336';
            errorContainer.style.padding = '15px';
            errorContainer.style.margin = '15px';
            errorContainer.style.borderRadius = '5px';
            errorContainer.style.border = '1px solid #f44336';
            
            errorContainer.innerHTML = `
                <h3>Error Loading Data</h3>
                <p>Could not load power plant data for year ${year}.</p>
                <p>Error details: ${error.message}</p>
                <p>Please check that the file "plants_${year}.json" exists and is properly formatted.</p>
            `;
            
            // Only add error message if not already displayed
            if (!document.querySelector('.error-message')) {
                errorContainer.className = 'error-message';
                document.body.insertBefore(errorContainer, document.getElementById('map'));
            }
        });
}

// Function to update the legend with plant counts
function updateLegend(categoryCounts) {
    // Remove existing legend
    const existingLegend = document.querySelector('.legend');
    if (existingLegend) {
        existingLegend.remove();
    }
    
    // Create new legend
    const legend = L.control({ position: "bottomright" });
    legend.onAdd = function () {
        const div = L.DomUtil.create("div", "legend");
        
        div.innerHTML += "<strong>Plant Types</strong><br>";
        
        // Add entries for each plant type
        Object.entries(plantTypeColors).forEach(([category, color]) => {
            if (category !== 'Converted') {
                const count = categoryCounts[category] || 0;
                div.innerHTML += `<i style="background:${color}"></i>${category} (${count})<br>`;
            }
        });
        
        // Add converted plant entry at the end
        const convertedCount = Object.keys(convertedPlants).length;
        div.innerHTML += `<i style="background:${plantTypeColors['Converted']}"></i>Converted (${convertedCount})<br>`;
        
        return div;
    };
    legend.addTo(map);
}

// Initialize map with starting year
loadYear(parseInt(yearSlider.value));

// Add event listener for year slider
yearSlider.addEventListener("input", () => {
    const selectedYear = parseInt(yearSlider.value);
    loadYear(selectedYear);
});