// Graph Simulation with D3.js
(function() {
    'use strict';

    const CONFIG = {
        minRadius: 10,
        maxRadius: 300,
        baseRadius: 14,
        linkDistance: 100,
        chargeStrength: -300,
        baseRepulsion: 5000,
        neighboursToCheck: 15,
        spawnRate: 102,
        neighbourLinkChance: 0
    };

    // Extra wide color gradient: 9 color stops across full spectrum
    const colorScale = d3.scaleLinear()
        .domain([0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1])
        .range([
            '#06b6d4',  // cyan
            '#22d3ee',  // light cyan
            '#34d399',  // emerald
            '#a3e635',  // lime
            '#facc15',  // yellow
            '#fb923c',  // orange
            '#f43f5e',  // rose
            '#e879f9',  // fuchsia
            '#a855f7'   // purple
        ])
        .interpolate(d3.interpolateHcl);

    let nodes = [];
    let links = [];
    let nodeIdCounter = 0;

    let svg, container, linkGroup, nodeGroup, simulation, zoom;
    let width, height;
    let currentTransform = d3.zoomIdentity;
    let deleteMode = false; // Track if S key is pressed
    
    // Auto-spawn state
    let autoSpawnInterval = null;
    let spawnPosition = { x: 0, y: 0 };
    let autoSpawnMode = false; // Track if P key is pressed

    function init() {
        width = window.innerWidth;
        height = window.innerHeight;

        svg = d3.select('#simulation-canvas')
            .attr('width', width)
            .attr('height', height);

        // Create container for zoom/pan
        container = svg.append('g').attr('class', 'container');

        // Create groups for links and nodes
        linkGroup = container.append('g').attr('class', 'links');
        nodeGroup = container.append('g').attr('class', 'nodes');

        // Setup zoom behavior (disabled when in auto-spawn or delete mode)
        zoom = d3.zoom()
            .scaleExtent([0, Infinity])
            .filter(event => {
                // Disable zoom when P or S key is pressed
                if (autoSpawnMode || deleteMode) return false;
                // Default filter: allow all except right-click
                return !event.ctrlKey && !event.button;
            })
            .on('zoom', zoomed);

        svg.call(zoom);

        // Initialize force simulation
        simulation = d3.forceSimulation(nodes)
            .force('link', d3.forceLink(links).id(d => d.id).distance(CONFIG.linkDistance))
            .force('charge', d3.forceManyBody().strength(CONFIG.chargeStrength))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collision', d3.forceCollide().radius(d => d.radius + 5))
            .on('tick', ticked);

        // Create initial node at center
        addNode(width / 2, height / 2, true);
        updateGraph();
        simulation.alpha(1).restart();

        // Click handler for canvas
        svg.on('click', function(event) {
            if (autoSpawnMode) return; // Skip regular click in auto-spawn mode
            if (event.target.tagName === 'circle') return;
            
            const [mx, my] = d3.pointer(event);
            const transform = currentTransform;
            const x = (mx - transform.x) / transform.k;
            const y = (my - transform.y) / transform.k;
            
            addNodeAtPosition(x, y);
        });

        // Auto-spawn with P key + mouse
        const svgNode = svg.node();
        
        function handlePressStart(event) {
            if (!autoSpawnMode) return;
            if (event.target.tagName === 'circle') return;
            
            const [mx, my] = d3.pointer(event, svgNode);
            const transform = currentTransform;
            spawnPosition.x = (mx - transform.x) / transform.k;
            spawnPosition.y = (my - transform.y) / transform.k;
            
            startAutoSpawn();
        }
        
        function handlePressEnd() {
            stopAutoSpawn();
        }
        
        function handleMove(event) {
            if (autoSpawnInterval) {
                const [mx, my] = d3.pointer(event, svgNode);
                const transform = currentTransform;
                spawnPosition.x = (mx - transform.x) / transform.k;
                spawnPosition.y = (my - transform.y) / transform.k;
            }
        }
        
        svgNode.addEventListener('mousedown', handlePressStart);
        svgNode.addEventListener('touchstart', handlePressStart);
        svgNode.addEventListener('mouseup', handlePressEnd);
        svgNode.addEventListener('touchend', handlePressEnd);
        svgNode.addEventListener('mouseleave', handlePressEnd);
        svgNode.addEventListener('mousemove', handleMove);
        svgNode.addEventListener('touchmove', handleMove);

        // Disable double-click zoom
        svg.on('dblclick.zoom', null);

        // Handle resize
        window.addEventListener('resize', function() {
            width = window.innerWidth;
            height = window.innerHeight;
            svg.attr('width', width).attr('height', height);
            simulation.force('center', d3.forceCenter(width / 2, height / 2));
            simulation.alpha(0.3).restart();
        });

        // Track S key for delete mode
        window.addEventListener('keydown', function(event) {
            if (event.key === 's' || event.key === 'S') {
                deleteMode = true;
                svg.style('cursor', 'crosshair');
            }
            if (event.key === 'p' || event.key === 'P') {
                autoSpawnMode = true;
                svg.style('cursor', 'cell');
            }
        });

        window.addEventListener('keyup', function(event) {
            if (event.key === 's' || event.key === 'S') {
                deleteMode = false;
                svg.style('cursor', null);
            }
            if (event.key === 'p' || event.key === 'P') {
                autoSpawnMode = false;
                stopAutoSpawn();
                svg.style('cursor', null);
            }
        });

        // Max size slider
        const maxSizeSlider = document.getElementById('maxSizeSlider');
        const maxSizeValue = document.getElementById('maxSizeValue');
        
        if (maxSizeSlider) {
            maxSizeSlider.addEventListener('input', function() {
                CONFIG.maxRadius = parseInt(this.value);
                maxSizeValue.textContent = this.value;
                updateGraph();
                simulation.alpha(1).restart();
            });
        }

        // Repulsion force slider
        const forceSlider = document.getElementById('forceSlider');
        const forceValue = document.getElementById('forceValue');
        
        if (forceSlider) {
            forceSlider.addEventListener('input', function() {
                CONFIG.baseRepulsion = parseInt(this.value);
                forceValue.textContent = this.value;
                updateGraph();
                simulation.alpha(1).restart();
            });
        }

        // Neighbours to check slider
        const neighboursSlider = document.getElementById('neighboursSlider');
        const neighboursValue = document.getElementById('neighboursValue');
        
        if (neighboursSlider) {
            neighboursSlider.addEventListener('input', function() {
                CONFIG.neighboursToCheck = parseInt(this.value);
                neighboursValue.textContent = this.value;
            });
        }

        // Spawn rate slider
        const spawnRateSlider = document.getElementById('spawnRateSlider');
        const spawnRateValue = document.getElementById('spawnRateValue');
        
        if (spawnRateSlider) {
            spawnRateSlider.addEventListener('input', function() {
                CONFIG.spawnRate = parseInt(this.value);
                spawnRateValue.textContent = this.value;
                // Restart auto-spawn with new rate if active
                if (autoSpawnInterval) {
                    stopAutoSpawn();
                    startAutoSpawn();
                }
            });
        }

        // Neighbour link chance slider
        const neighbourLinkSlider = document.getElementById('neighbourLinkSlider');
        const neighbourLinkValue = document.getElementById('neighbourLinkValue');
        
        if (neighbourLinkSlider) {
            neighbourLinkSlider.addEventListener('input', function() {
                CONFIG.neighbourLinkChance = parseInt(this.value);
                neighbourLinkValue.textContent = this.value;
            });
        }
    }

    function zoomed(event) {
        currentTransform = event.transform;
        container.attr('transform', currentTransform);
    }

    // Calculate weight for each node based on connections and subtree size
    function calculateWeights() {
        // Build adjacency map
        const adjacency = new Map();
        nodes.forEach(n => adjacency.set(n.id, []));
        
        links.forEach(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            if (adjacency.has(sourceId)) adjacency.get(sourceId).push(targetId);
            if (adjacency.has(targetId)) adjacency.get(targetId).push(sourceId);
        });

        // Calculate subtree weight recursively (with memoization to handle cycles)
        function getSubtreeWeight(nodeId, visited) {
            if (visited.has(nodeId)) return 0;
            visited.add(nodeId);
            
            const neighbors = adjacency.get(nodeId) || [];
            let weight = 1; // Count self
            
            neighbors.forEach(neighborId => {
                weight += getSubtreeWeight(neighborId, visited) * 0.5; // Children contribute 50%
            });
            
            return weight;
        }

        // Calculate weight for each node
        nodes.forEach(node => {
            const directConnections = (adjacency.get(node.id) || []).length;
            const subtreeWeight = getSubtreeWeight(node.id, new Set());
            
            // Combine direct connections and subtree weight
            node.weight = directConnections + subtreeWeight;
        });

        // Normalize weights to radius and color with steeper curve
        const maxWeight = Math.max(...nodes.map(n => n.weight), 1);
        
        nodes.forEach(node => {
            const normalizedWeight = node.weight / maxWeight;
            // Apply power curve for more dramatic size differences
            const curvedWeight = Math.pow(normalizedWeight, 0.5); // Square root = steeper curve
            node.radius = CONFIG.minRadius + curvedWeight * (CONFIG.maxRadius - CONFIG.minRadius);
            node.color = colorScale(curvedWeight);
            // Slightly darker stroke
            node.stroke = d3.color(node.color).darker(0.5).toString();
        });
    }

    function addNode(x, y, isInitial) {
        const node = {
            id: nodeIdCounter++,
            x: x,
            y: y,
            isInitial: isInitial || false,
            weight: 1,
            radius: CONFIG.baseRadius,
            color: colorScale(0),
            stroke: d3.color(colorScale(0)).darker(0.5).toString()
        };
        nodes.push(node);
        return node;
    }

    function deleteNode(nodeData) {
        // Remove all links connected to this node
        links = links.filter(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            return sourceId !== nodeData.id && targetId !== nodeData.id;
        });

        // Remove the node itself
        nodes = nodes.filter(n => n.id !== nodeData.id);

        updateGraph();
        simulation.alpha(0.3).restart();
    }

    function addNodeAtPosition(x, y) {
        if (nodes.length === 0) return;

        // Calculate distances to all nodes and sort by distance
        const sortedByDistance = nodes
            .map(n => ({ node: n, dist: Math.hypot(n.x - x, n.y - y) }))
            .sort((a, b) => a.dist - b.dist);

        // Get nearby nodes (up to configured amount)
        const nearbyNodes = sortedByDistance.slice(0, CONFIG.neighboursToCheck);

        if (nearbyNodes.length === 0) return;

        // From nearby nodes, get the 5 biggest by radius
        const biggestFive = nearbyNodes
            .sort((a, b) => b.node.radius - a.node.radius)
            .slice(0, 5);

        // Pick a random one from the 5 biggest nearby nodes
        const randomTarget = biggestFive[Math.floor(Math.random() * biggestFive.length)].node;

        const newNode = addNode(x, y, false);
        links.push({ source: newNode.id, target: randomTarget.id });

        // Chance to also connect nearby nodes together
        if (CONFIG.neighbourLinkChance > 0 && biggestFive.length >= 2) {
            for (let i = 0; i < biggestFive.length; i++) {
                for (let j = i + 1; j < biggestFive.length; j++) {
                    if (Math.random() * 100 < CONFIG.neighbourLinkChance) {
                        const nodeA = biggestFive[i].node;
                        const nodeB = biggestFive[j].node;
                        
                        // Check if link already exists
                        const linkExists = links.some(link => {
                            const sid = typeof link.source === 'object' ? link.source.id : link.source;
                            const tid = typeof link.target === 'object' ? link.target.id : link.target;
                            return (sid === nodeA.id && tid === nodeB.id) || (sid === nodeB.id && tid === nodeA.id);
                        });
                        
                        if (!linkExists) {
                            links.push({ source: nodeA.id, target: nodeB.id });
                        }
                    }
                }
            }
        }

        updateGraph();
        simulation.alpha(0.5).restart();
    }

    function updateGraph() {
        // Recalculate weights and sizes
        calculateWeights();

        // Update links
        const link = linkGroup.selectAll('.link').data(links, d => {
            const sid = typeof d.source === 'object' ? d.source.id : d.source;
            const tid = typeof d.target === 'object' ? d.target.id : d.target;
            return `${sid}-${tid}`;
        });

        link.exit().remove();

        link.enter()
            .append('line')
            .attr('class', 'link')
            .merge(link);

        // Update nodes
        const node = nodeGroup.selectAll('.node').data(nodes, d => d.id);

        node.exit().remove();

        const nodeEnter = node.enter()
            .append('g')
            .attr('class', 'node')
            .call(d3.drag()
                .on('start', dragstarted)
                .on('drag', dragged)
                .on('end', dragended));

        nodeEnter.append('circle')
            .on('click', function(event, d) {
                if (deleteMode) {
                    event.stopPropagation();
                    deleteNode(d);
                }
            });

        // Merge and update all circles with current radius and color
        const allNodes = nodeEnter.merge(node);
        
        allNodes.select('circle')
            .transition()
            .duration(300)
            .attr('r', d => d.radius)
            .attr('fill', d => d.color)
            .attr('stroke', d => d.stroke);

        // Update simulation with dynamic forces that scale with max size
        const sizeScale = CONFIG.maxRadius / 50; // Scale factor (50 is the default)
        
        simulation.nodes(nodes);
        
        // Links: scale distance with size, bigger nodes = relatively tighter
        simulation.force('link')
            .links(links)
            .distance(link => {
                const sourceRadius = link.source.radius || CONFIG.minRadius;
                const targetRadius = link.target.radius || CONFIG.minRadius;
                const avgRadius = (sourceRadius + targetRadius) / 2;
                // Base distance scales with size, minus tightening for big nodes
                const baseDistance = CONFIG.linkDistance * sizeScale;
                return Math.max(avgRadius * 1.5, baseDistance - avgRadius * 0.5);
            })
            .strength(link => {
                const sourceRadius = link.source.radius || CONFIG.minRadius;
                const targetRadius = link.target.radius || CONFIG.minRadius;
                const avgRadius = (sourceRadius + targetRadius) / 2;
                // Larger nodes get stronger link strength (0.5 to 2)
                return 0.5 + (avgRadius / CONFIG.maxRadius) * 1.5;
            });
        
        // Collision scales with radius plus proportional padding
        simulation.force('collision', d3.forceCollide().radius(d => d.radius * 1.2 + 10).strength(1));
        
        // Charge scales with size
        simulation.force('charge', d3.forceManyBody().strength(d => {
            const baseCharge = -CONFIG.baseRepulsion * sizeScale;
            return baseCharge - d.radius * 3;
        }));
    }

    function ticked() {
        linkGroup.selectAll('.link')
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);

        nodeGroup.selectAll('.node')
            .attr('transform', d => `translate(${d.x},${d.y})`);
    }

    function dragstarted(event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) simulation.alphaTarget(0);
        
        // Check if dropped on another node
        const targetNode = findNodeAtPosition(event.x, event.y, d);
        
        if (targetNode) {
            // Check if link already exists
            const linkExists = links.some(link => {
                const sid = typeof link.source === 'object' ? link.source.id : link.source;
                const tid = typeof link.target === 'object' ? link.target.id : link.target;
                return (sid === d.id && tid === targetNode.id) || (sid === targetNode.id && tid === d.id);
            });
            
            if (!linkExists) {
                links.push({ source: d.id, target: targetNode.id });
                updateGraph();
                simulation.alpha(0.3).restart();
            }
        }
        
        d.fx = null;
        d.fy = null;
    }

    function startAutoSpawn() {
        if (autoSpawnInterval) return;
        
        // Spawn first node immediately
        addNodeAtPosition(spawnPosition.x + (Math.random() - 0.5) * 50, spawnPosition.y + (Math.random() - 0.5) * 50);
        
        // Continue spawning at rate
        autoSpawnInterval = setInterval(() => {
            // Add some randomness to position
            const x = spawnPosition.x + (Math.random() - 0.5) * 50;
            const y = spawnPosition.y + (Math.random() - 0.5) * 50;
            addNodeAtPosition(x, y);
        }, CONFIG.spawnRate);
    }

    function stopAutoSpawn() {
        if (autoSpawnInterval) {
            clearInterval(autoSpawnInterval);
            autoSpawnInterval = null;
        }
    }

    // Find a node at given position (excluding the dragged node)
    function findNodeAtPosition(x, y, excludeNode) {
        for (const node of nodes) {
            if (node === excludeNode) continue;
            const dist = Math.hypot(node.x - x, node.y - y);
            // Larger detection area for easier connecting
            if (dist < node.radius * 2 + 20) {
                return node;
            }
        }
        return null;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
