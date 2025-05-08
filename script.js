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
    'Biomass': 'brown',
    'Geothermal': 'red',
    'Other': 'gray',
    'Converted': 'green'
};

// Plant type distribution (approximate percentages for the US)
const plantTypeDistribution = {
    'Natural Gas': 43,
    'Coal': 19,
    'Nuclear': 8,
    'Hydro': 7,
    'Wind': 10,
    'Solar': 6,
    'Biomass': 5,
    'Geothermal': 2
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

// Function to generate a realistic dataset of power plants
function generatePowerPlants(year, count = 3000) {
    // US bounds for random generation
    const bounds = {
        north: 49.3457868, // northern border
        south: 24.7433195, // southern tip of Florida
        east: -66.9513812, // eastern coast
        west: -124.7844079 // western coast
    };
    
    // Population centers to cluster around
    const populationCenters = [
        {name: "Northeast", lat: 40.7128, lng: -74.0060, radius: 300, weight: 0.2},
        {name: "Midwest", lat: 41.8781, lng: -87.6298, radius: 400, weight: 0.15},
        {name: "South", lat: 32.7767, lng: -96.7970, radius: 400, weight: 0.25},
        {name: "West Coast", lat: 37.7749, lng: -122.4194, radius: 350, weight: 0.15},
        {name: "Southwest", lat: 33.4484, lng: -112.0740, radius: 300, weight: 0.1},
        {name: "Northwest", lat: 47.6062, lng: -122.3321, radius: 250, weight: 0.05},
        {name: "Southeast", lat: 33.7490, lng: -84.3880, radius: 300, weight: 0.1}
    ];
    
    const plants = [];
    
    // Helper function to get a random point clustered around population centers
    function getRandomLocation() {
        // Decide if we're placing near a population center or randomly
        const usePopCenter = Math.random() < 0.8; // 80% of plants near population centers
        
        if (usePopCenter) {
            // Choose a random population center based on weight
            let rand = Math.random();
            let sum = 0;
            let chosenCenter;
            
            for (const center of populationCenters) {
                sum += center.weight;
                if (rand < sum) {
                    chosenCenter = center;
                    break;
                }
            }
            
            // Random angle and adjusted distance from center
            const angle = Math.random() * 2 * Math.PI;
            const distance = Math.random() * chosenCenter.radius;
            
            // Calculate offset (rough approximation)
            const latOffset = distance * Math.cos(angle) * 0.01;
            const lngOffset = distance * Math.sin(angle) * 0.01;
            
            return {
                lat: chosenCenter.lat + latOffset,
                lng: chosenCenter.lng + lngOffset
            };
        } else {
            // Completely random location within US bounds
            return {
                lat: bounds.south + Math.random() * (bounds.north - bounds.south),
                lng: bounds.west + Math.random() * (bounds.east - bounds.west)
            };
        }
    }
    
    // Generate plants
    for (let i = 0; i < count; i++) {
        // Choose plant type based on distribution
        let rand = Math.random() * 100;
        let sum = 0;
        let chosenType;
        
        for (const [type, percentage] of Object.entries(plantTypeDistribution)) {
            sum += percentage;
            if (rand < sum) {
                chosenType = type;
                break;
            }
        }
        
        // Get random location
        const location = getRandomLocation();
        
        // Create plant
        plants.push({
            id: i + 1,
            name: `${chosenType} Plant ${i + 1}`,
            type: chosenType,
            lat: location.lat,
            lng: location.lng,
            year_built: Math.floor(1950 + Math.random() * (year - 1950))
        });
    }
    
    // Add historical trend - fewer renewables in past years
    if (year < 2023) {
        // Adjust plant types based on year
        plants.forEach(plant => {
            // The further back in time, the more likely renewable plants are to be converted to fossil fuels
            const yearFactor = (2023 - year) / 10; // 0.0 to ~1.0
            
            if ((plant.type === 'Wind' || plant.type === 'Solar') && Math.random() < yearFactor * 0.8) {
                plant.type = Math.random() < 0.7 ? 'Coal' : 'Natural Gas';
                plant.name = `${plant.type} Plant ${plant.id}`;
            }
        });
    }
    
    return plants;
}

// Function to load plant data for a specific year
function loadYear(year) {
    clearMarkers();
    yearLabel.textContent = year;
    
    // Reset CO2 counter when changing years but maintain converted plants
    if (!Object.keys(convertedPlants).length) {
        totalCO2Saved = 0;
    }
    
    co2Display.textContent = `Total CO2 Saved: ${totalCO2Saved.toLocaleString()} tons`;
    
    // Generate a large dataset of plants
    const generatedPlants = generatePowerPlants(year);
    
    // Sort plants by type for better organization
    const sortedPlants = generatedPlants.sort((a, b) => a.type.localeCompare(b.type));
    
    // For performance with large datasets, consider clustering
    const plantsByType = {};
    
    // Group plants by type for potential clustering
    sortedPlants.forEach(plant => {
        if (!plantsByType[plant.type]) {
            plantsByType[plant.type] = [];
        }
        plantsByType[plant.type].push(plant);
    });
    
    // Process all plant types
    Object.entries(plantsByType).forEach(([type, plants]) => {
        // Add individual plants to the map
        plants.forEach(plant => {
            const id = plant.id;
            const converted = convertedPlants[id] || false;
            
            // Create marker with appropriate styling
            const marker = L.circleMarker([plant.lat, plant.lng], {
                color: 'white',
                weight: 2,
                fillColor: getColor(type, converted),
                radius: 15,  // Large radius but not too large when we have thousands of markers
                fillOpacity: 0.85
            }).addTo(map);
            
            // Add popup with plant info
            marker.bindPopup(`
                <strong>${plant.name}</strong><br>
                Type: ${plant.type}<br>
                Built: ${plant.year_built}<br>
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
    });
    
    // Log how many plants were created
    console.log(`Generated ${markers.length} power plant markers for year ${year}`);
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
    
    // Add entries for each plant type (except 'Other' and 'Converted')
    Object.entries(plantTypeDistribution).forEach(([type, percentage]) => {
        const color = plantTypeColors[type];
        div.innerHTML += `<i style="background:${color}"></i>${type} (${percentage}%)<br>`;
    });
    
    // Add converted plant entry at the end
    div.innerHTML += "<i style=\"background:green\"></i>Converted Plant<br>";
    
    return div;
};
legend.addTo(map);

// Improve performance by disabling world wrap
map.worldCopyJump = false;