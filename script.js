// Initialize the map centered on the US
let map = L.map('map').setView([39.5, -98.35], 4);

// Add the OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Helper function for formatting coordinates safely
function safeFixed(value, digits = 4) {
    return (typeof value === "number" && !isNaN(value)) ? value.toFixed(digits) : "N/A";
}

// Array to store markers for easy removal when changing years
let markers = [];
let totalCO2Saved = 0;
let totalCO2Produced = 0;

// Track yearly CO2 data for chronological cumulative calculations
let yearlyData = {};
let currentYear = null;   
let allYears = [];
for (let year = 2015; year <= 2023; year++) {
    allYears.push(year);
}

// Get DOM elements
const yearSlider = document.getElementById("yearRange");
const yearLabel = document.getElementById("yearLabel");
const co2Display = document.getElementById("co2");

// Track which plants are "converted" by their ID
let convertedPlants = {};

// A place to store this year’s raw plant data
let currentPlants = [];

// Conversion slider state
let conversionPercent = 0;
const percentSlider = document.getElementById('percentSlider');
const percentLabel  = document.getElementById('percentLabel');

// When the user drags the % slider, re-draw
percentSlider.addEventListener('input', () => {
  conversionPercent = parseInt(percentSlider.value, 10);
  percentLabel.textContent = `${conversionPercent}%`;
  applyConversionPercentage();
});


currentPlants = handleNaN(data);       // keep a clean copy
applyConversionPercentage();           // draw X% converted



// Define categories for simplifying the many power plant types
const typeCategories = {
    'Coal': ['Conventional Steam Coal', 'Coal'],
    'Natural Gas': ['Natural Gas Fired Combined Cycle', 'Natural Gas Fired Combustion Turbine', 'Natural Gas Steam Turbine'],
    'Nuclear': ['Nuclear'],
    'Hydro': ['Conventional Hydroelectric'],
    'Oil': ['Petroleum Liquids'],
    'Wind': ['Wind'],
    'Solar': ['Solar Photovoltaic', 'Solar Thermal'],
    'Other': [] // Anything else falls here
};

// CO2 emission factors per plant type (tons per year)
const co2Factors = {
    'Coal': 2_000_000,       // High emissions
    'Natural Gas': 1_000_000, // Medium emissions 
    'Oil': 1_500_000,         // Medium-high emissions
    'Nuclear': 50_000,        // Very low (for plant operations, not the actual nuclear process)
    'Hydro': 30_000,          // Very low (for infrastructure maintenance)
    'Wind': 20_000,           // Minimal (for maintenance)
    'Solar': 20_000,          // Minimal (for maintenance)
    'Other': 500_000          // Moderate default
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
    // Handle NaN values from JSON
    if (!type || type === "NaN" || type === "null" || type === "undefined") return 'Other';
    
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

// Function to handle NaN values in JSON data
function handleNaN(data) {
    return data.map(plant => {
        if (plant.type === null || plant.type === undefined || plant.type === NaN || plant.type === "NaN") {
            return { ...plant, type: "Other" };
        }
        return plant;
    });
}

// Function to format large numbers with commas and units
function formatNumber(number) {
    if (number >= 1_000_000_000) {
        return (number / 1_000_000_000).toFixed(2) + ' billion';
    } else if (number >= 1_000_000) {
        return (number / 1_000_000).toFixed(2) + ' million';
    } else {
        return number.toLocaleString();
    }
}

// Function to update CO2 summary displays
function updateCO2Summary() {
    // Update the CO2 saved display
    co2Display.innerHTML = `
        <div>Total CO2 Saved: ${formatNumber(totalCO2Saved)} tons</div>
        <div>Total CO2 Produced: ${formatNumber(totalCO2Produced)} tons</div>
        <div>Net CO2 Impact: ${formatNumber(totalCO2Produced - totalCO2Saved)} tons</div>
    `;
    
    // Add color coding based on net impact
    const netImpact = totalCO2Produced - totalCO2Saved;
    
    if (netImpact <= 0) {
        co2Display.style.backgroundColor = '#c8e6c9'; // Light green for positive impact
    } else if (netImpact < totalCO2Produced * 0.5) {
        co2Display.style.backgroundColor = '#fff9c4'; // Light yellow for moderate impact
    } else {
        co2Display.style.backgroundColor = '#ffcdd2'; // Light red for high impact
    }
}

// Function to load plant data for a specific year
function loadYear(year) {
    clearMarkers();
    currentYear = year;              
    yearLabel.textContent = year;
    
    // Reset CO2 counter when changing years if no plants have been converted
    if (Object.keys(convertedPlants).length === 0) {
        totalCO2Saved = 0;
    }
    
    // Reset CO2 production counter for each year
    totalCO2Produced = 0;
    
    // Create URL for current year's JSON file
    const jsonUrl = `plants_${year}.json`;
    console.log(`Attempting to load: ${jsonUrl}`);
    
    // Try to fetch the data for the current year
    fetch(jsonUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`Failed to fetch ${jsonUrl}: ${response.status} ${response.statusText}`);
            }
            console.log(`Successfully fetched ${jsonUrl}`);
            return response.json();
        })
        .then(data => {
            console.log(`Loaded ${data.length} plants from ${jsonUrl}`);
            
            // Handle any NaN values in the data
            const cleanData = handleNaN(data);
            
            // Calculate category counts for the legend and CO2 totals
            const categoryCounts = {};
            Object.keys(plantTypeColors).forEach(category => {
                categoryCounts[category] = 0;
            });
            
            // Process and display each plant
            cleanData.forEach(plant => {
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
                
                // Count this plant in its category
                categoryCounts[category] = (categoryCounts[category] || 0) + 1;
                
                // Add to total CO2 produced if not converted
                if (!converted) {
                    totalCO2Produced += co2Factors[category] || co2Factors['Other'];
                }
                
                // Create marker with appropriate styling
                const marker = L.circleMarker([plant.lat, plant.lng], {
                    color: 'white',
                    weight: 2,
                    fillColor: getColor(type, converted),
                    radius: 20,
                    fillOpacity: 0.85
                }).addTo(map);
                
                // Add popup with plant info including CO2 impact
                marker.bindPopup(`
                    <strong>${plant.name}</strong><br>
                    Location: ${plant.state}<br>
                    Type: ${type || 'Unknown'}<br>
                    Category: ${category}<br>
                    Status: ${converted ? 'Converted to Clean Energy' : 'Original Power Source'}<br>
                    CO2 Impact: ${formatNumber(co2Factors[category] || co2Factors['Other'])} tons/year<br>
                    Coordinates: ${safeFixed(plant.lat)}, ${safeFixed(plant.lng)}
                `);
                
                // Add click event for conversion
                marker.on('click', () => {
                    if (!convertedPlants[id]) {
                        convertedPlants[id] = true;
                        marker.setStyle({ fillColor: plantTypeColors['Converted'] });
                        
                        // Subtract this plant's emissions from the total produced
                        // when it gets converted to clean energy
                        totalCO2Produced -= co2Factors[category] || co2Factors['Other'];
                        
                        // Add CO2 savings based on plant type
                        totalCO2Saved += co2Factors[category] || co2Factors['Other'];
                        
                        // Update the marker popup to show converted status
                        marker.setPopupContent(`
                            <strong>${plant.name}</strong><br>
                            Location: ${plant.state}<br>
                            Type: ${type || 'Unknown'}<br>
                            Category: ${category}<br>
                            Status: Converted to Clean Energy<br>
                            CO2 Saved: ${formatNumber(co2Factors[category] || co2Factors['Other'])} tons/year<br>
                            Coordinates: ${safeFixed(plant.lat)}, ${safeFixed(plant.lng)}
                        `);
                        
                        // Update CO2 summary
                        updateCO2Summary();
                        
                        // Update the legend (to show the converted count)
                        updateLegend(categoryCounts);
                    }
                });
                
                // Store marker reference
                markers.push(marker);
            });
            
            console.log(`Added ${markers.length} markers to the map`);
            console.log("Plants by category:", categoryCounts);
            console.log("Total CO2 produced:", totalCO2Produced);
            
            // Record this year’s totals so we can build a running sum
            yearlyData[year] = {
              produced: totalCO2Produced,
              saved: totalCO2Saved
            };

            // Now update the display to show the truly cumulative numbers
            updateCO2Summary();
            
            // Update the legend with counts
            updateLegend(categoryCounts);
            
            // Remove any error messages if the load was successful
            const errorMessage = document.querySelector('.error-message');
            if (errorMessage) {
                errorMessage.remove();
            }
        })
        .catch(error => {
            console.error(`Error loading data from ${jsonUrl}:`, error);
            
            // Create and display an error message
            showErrorMessage(year, error);
            
            // If we can't load the current year, try to load a different one
            // Only try this if we haven't already shown markers
            if (markers.length === 0) {
                tryAlternativeYears(year);
            }
        });
}

// Function to display error messages
function showErrorMessage(year, error) {
    // Remove any existing error messages
    const existingError = document.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Create error container
    const errorContainer = document.createElement('div');
    errorContainer.className = 'error-message';
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
        <p>Please make sure you have the following files in the same directory as your HTML file:</p>
        <ul>
            <li>plants_2014.json</li>
            <li>plants_2015.json</li>
            <li>...</li>
            <li>plants_2023.json</li>
        </ul>
    `;
    
    // Insert error message before the map
    document.body.insertBefore(errorContainer, document.getElementById('map'));
}

// Function to try alternative years if the current one fails
function tryAlternativeYears(currentYear) {
    // Try years from 2014 to 2023 (excluding the current one)
    console.log(`Trying to find an alternative data file...`);
    
    // Create an array of years to try
    const years = [];
    for (let year = 2014; year <= 2023; year++) {
        if (year !== currentYear) {
            years.push(year);
        }
    }
    
    // Try each year one by one
    tryNextYear(years, 0);
}

// Recursive function to try loading from the next year in the list
function tryNextYear(years, index) {
    if (index >= years.length) {
        console.error("Couldn't load data from any year");
        return;
    }
    
    const year = years[index];
    const jsonUrl = `plants_${year}.json`;
    
    console.log(`Trying alternative: ${jsonUrl}`);
    
    fetch(jsonUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error("Failed to fetch");
            }
            return response.json();
        })
        .then(data => {
            console.log(`Successfully loaded alternative data from ${jsonUrl}`);
            
            // Update the year slider to match the loaded data
            yearSlider.value = year;
            
            // Load the data for this year
            loadYear(year);
            
            // Show a notification that we've loaded a different year
            const notification = document.createElement('div');
            notification.style.backgroundColor = '#e8f5e9';
            notification.style.color = '#2e7d32';
            notification.style.padding = '10px';
            notification.style.margin = '10px 0';
            notification.style.borderRadius = '5px';
            notification.style.textAlign = 'center';
            notification.innerHTML = `<strong>Note:</strong> Loaded data for ${year} instead, as the requested year was not available.`;
            
            // Remove any existing notifications
            const existingNotification = document.querySelector('.year-notification');
            if (existingNotification) {
                existingNotification.remove();
            }
            
            // Add the class for later reference
            notification.className = 'year-notification';
            
            // Insert notification before controls
            document.body.insertBefore(notification, document.getElementById('controls'));
        })
        .catch(error => {
            console.error(`Alternative ${jsonUrl} also failed:`, error);
            // Try the next year
            tryNextYear(years, index + 1);
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
        
        // Add entries for each plant type with counts and CO2 impact
        Object.entries(plantTypeColors).forEach(([category, color]) => {
            if (category !== 'Converted') {
                const count = categoryCounts[category] || 0;
                const co2PerPlant = co2Factors[category] || co2Factors['Other'];
                div.innerHTML += `
                    <i style="background:${color}"></i>
                    ${category} (${count}) - ${formatNumber(co2PerPlant)} tons/year per plant<br>
                `;
            }
        });
        
        // Add converted plant entry at the end
        const convertedCount = Object.keys(convertedPlants).length;
        div.innerHTML += `<i style="background:${plantTypeColors['Converted']}"></i>Converted (${convertedCount})<br>`;
        
        return div;
    };
    legend.addTo(map);
}

// Check if any JSON file exists and create JSON files if needed
function createJSONFiles() {
    const jsonNames = [];
    
    for (let year = 2014; year <= 2023; year++) {
        jsonNames.push(`plants_${year}.json`);
    }
    
    Promise.all(jsonNames.map(file => 
        fetch(file)
            .then(response => {
                if (!response.ok) throw new Error(`${file} not found`);
                return file;
            })
            .catch(() => null)
    ))
    .then(results => {
        const missingFiles = results.filter(result => result === null).length;
        
        if (missingFiles === jsonNames.length) {
            // All files are missing, show a message with instructions to fix
            const message = document.createElement('div');
            message.style.backgroundColor = '#fff3cd';
            message.style.color = '#856404';
            message.style.padding = '15px';
            message.style.margin = '15px';
            message.style.borderRadius = '5px';
            message.style.border = '1px solid #ffeeba';
            
            message.innerHTML = `
                <h3>Missing Data Files</h3>
                <p>All the required JSON files are missing. The application needs files named:</p>
                <ul>
                    ${jsonNames.map(file => `<li>${file}</li>`).join('')}
                </ul>
                <p>These files should contain your power plant data.</p>
                <p>For now, we'll use the current year, but you may see an error.</p>
            `;
            
            document.body.insertBefore(message, document.getElementById('controls'));
        } else if (missingFiles > 0) {
            // Some files are missing
            const foundFiles = results.filter(result => result !== null);
            console.log(`Found ${foundFiles.length} JSON files: ${foundFiles.join(', ')}`);
            
            const missingFileNames = jsonNames.filter(name => !results.includes(name));
            console.log(`Missing ${missingFiles} JSON files: ${missingFileNames.join(', ')}`);
            
            // Show a less prominent warning
            const warning = document.createElement('div');
            warning.style.backgroundColor = '#fff3cd';
            warning.style.color = '#856404';
            warning.style.padding = '10px';
            warning.style.margin = '10px 0';
            warning.style.borderRadius = '5px';
            warning.style.textAlign = 'center';
            warning.innerHTML = `<strong>Note:</strong> Some years' data files are missing. The slider might not work for all years.`;
            
            document.body.insertBefore(warning, document.getElementById('controls'));
        } else {
            console.log("All JSON files found!");
        }
    });
}

// Function to format large numbers with commas and units
function formatNumber(number) {
    if (number >= 1_000_000_000) {
        return (number / 1_000_000_000).toFixed(2) + ' billion';
    } else if (number >= 1_000_000) {
        return (number / 1_000_000).toFixed(2) + ' million';
    } else {
        return number.toLocaleString();
    }
}

// Function to update CO2 summary displays showing true chronological cumulative totals
function updateCO2Summary() {
    // Calculate cumulative CO2 for all years up to and including the current year
    let cumulativeCO2Produced = 0;
    let cumulativeCO2Saved = 0;
    
    // Add all years' data in chronological order up to the current year
    allYears.forEach(year => {
        if (year <= currentYear) {
            if (year === currentYear) {
                // Current year data is in the active variables
                cumulativeCO2Produced += totalCO2Produced;
                cumulativeCO2Saved += totalCO2Saved;
            } else if (yearlyData[year]) {
                // Previous years data is stored in yearlyData
                cumulativeCO2Produced += yearlyData[year].produced;
                cumulativeCO2Saved += yearlyData[year].saved;
            }
        }
    });
    
    // Update the CO2 saved display with cumulative values
    const co2Element = document.getElementById("co2");
    co2Element.innerHTML = `
        <div>Cumulative CO2 Produced (2015-${currentYear}): ${formatNumber(cumulativeCO2Produced)} tons</div>
        <div>Cumulative CO2 Saved (2015-${currentYear}): ${formatNumber(cumulativeCO2Saved)} tons</div>
        <div>Net CO2 Impact: ${formatNumber(cumulativeCO2Produced - cumulativeCO2Saved)} tons</div>
        <div class="year-info">Year ${currentYear}: Produced ${formatNumber(totalCO2Produced)} - Saved ${formatNumber(totalCO2Saved)}</div>
    `;
    
    // Add color coding based on net impact
    const netImpact = cumulativeCO2Produced - cumulativeCO2Saved;
    
    if (netImpact <= 0) {
        co2Element.style.backgroundColor = '#c8e6c9'; // Light green for positive impact
    } else if (netImpact < cumulativeCO2Produced * 0.5) {
        co2Element.style.backgroundColor = '#fff9c4'; // Light yellow for moderate impact
    } else {
        co2Element.style.backgroundColor = '#ffcdd2'; // Light red for high impact
    }
}

// Run file check on startup
createJSONFiles();

// Initialize map with starting year
loadYear(parseInt(yearSlider.value));

// Add event listener for year slider
yearSlider.addEventListener("input", () => {
    const selectedYear = parseInt(yearSlider.value);
    loadYear(selectedYear);
});

/**
 * Clear the map and redraw all plants,
 * converting exactly conversionPercent% to nuclear.
 */
function applyConversionPercentage() {
    // reset
    convertedPlants = {};
    totalCO2Saved    = 0;
    totalCO2Produced = 0;
    clearMarkers();
  
    // pick a random subset of plant IDs to convert
    const toConvertCount = Math.round(currentPlants.length * conversionPercent / 100);
    const shuffled       = currentPlants.slice().sort(() => Math.random() - 0.5);
    const convertSet     = new Set(shuffled.slice(0, toConvertCount).map(p => p.id));
  
    // track legend counts
    const categoryCounts = {};
    Object.keys(plantTypeColors).forEach(cat => categoryCounts[cat] = 0);
  
    // draw every plant
    currentPlants.forEach(plant => {
      const id        = plant.id;
      const isConverted = convertSet.has(id);
      const cat       = getCategory(plant.type);
  
      // accumulate production *only* for unconverted plants
      if (!isConverted) {
        totalCO2Produced += co2Factors[cat] || co2Factors['Other'];
      } else {
        totalCO2Saved += co2Factors[cat] || co2Factors['Other'];
        convertedPlants[id] = true;
      }
  
      // count for legend
      categoryCounts[cat]++;
  
      // draw marker
      const marker = L.circleMarker([plant.lat, plant.lng], {
        color:      'white',
        weight:     2,
        fillColor:  getColor(plant.type, isConverted),
        radius:     20,
        fillOpacity:0.85
      }).addTo(map);
  
      marker.bindPopup(`
        <strong>${plant.name}</strong><br>
        Type: ${plant.type}<br>
        Category: ${cat}<br>
        ${isConverted 
          ? `<em>Converted</em><br>✓ CO₂ saved: ${formatNumber(co2Factors[cat]||co2Factors['Other'])} t` 
          : `<em>Original</em><br>☐ CO₂ emitted: ${formatNumber(co2Factors[cat]||co2Factors['Other'])} t`
        }
      `);
  
      markers.push(marker);
    });
  
    // update both summary and legend
    updateCO2Summary();
    updateLegend(categoryCounts);
  }
  