/**
 * D3.js Visualization for Unity Asmdef Dependencies
 * Optimized for large graphs (150+ nodes)
 */

class AsmdefVisualizer {
    constructor() {
        this.parser = new AsmdefParser();
        this.svg = null;
        this.simulation = null;
        this.nodes = [];
        this.links = [];
        this.selectedNode = null;
        
        // Performance settings
        this.maxLabelNodes = 50; // Only show labels for first N nodes
        this.enableCollision = true;
        
        // Cache settings
        this.cachedData = null;
        this.cachedProjectPath = null;
        this.cacheKey = 'asmdef_visualizer_cache';
        this.fileCacheVersion = '1.0'; // Version for cache file format
        
        // Dependency display mode
        this.dependencyMode = 'both'; // 'both', 'outgoing', 'incoming'
        
        // Node filtering
        this.enabledNodeTypes = new Set(['Runtime', 'Game', 'Editor', 'Tests', 'Unity', 'Third Party']);
        this.allNodes = [];
        this.allLinks = [];
        
        // Initialize debug exporter
        this.debugExporter = null;
        
        this.init();
    }

    init() {
        this.setupSVG();
        this.setupFileInput();
        this.setupEventListeners();
        this.loadCachedData();
    }

    setupSVG() {
        const container = document.querySelector('.visualization-container');
        const svg = d3.select('#graph');
        
        // Get container dimensions
        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        
        svg.attr('width', width).attr('height', height);
        
        // Create zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 10])
            .on('zoom', (event) => {
                this.g.attr('transform', event.transform);
            });
        
        svg.call(zoom);
        
        // Create main group for all elements
        this.g = svg.append('g');
        
        // Store references
        this.svg = svg;
        this.width = width;
        this.height = height;
        this.zoom = zoom;
        
        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());
    }

    setupFileInput() {
        const folderInput = document.getElementById('folderInput');
        const reloadBtn = document.getElementById('reloadBtn');
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        const saveCacheBtn = document.getElementById('saveCacheBtn');
        const loadCacheBtn = document.getElementById('loadCacheBtn');
        const dependencyToggle = document.getElementById('dependencyToggle');
        
        folderInput.addEventListener('change', (event) => {
            this.loadProject(event.target.files);
            // Show controls after loading
            this.showControls();
            this.showNodeFilters();
        });
        
        reloadBtn.addEventListener('click', () => {
            this.reloadProject();
        });
        
        clearCacheBtn.addEventListener('click', () => {
            this.clearCache();
            // Clear the visualization
            this.g.selectAll('*').remove();
            document.getElementById('stats').textContent = 'Cache cleared - select project folder to reload';
        });

        saveCacheBtn.addEventListener('click', () => {
            this.saveCacheToFile();
        });

        loadCacheBtn.addEventListener('click', () => {
            this.loadCacheFromFile();
        });
        
        // Handle dependency mode toggle
        const depRadios = document.querySelectorAll('input[name="depType"]');
        depRadios.forEach(radio => {
            radio.addEventListener('change', (event) => {
                this.dependencyMode = event.target.value;
                this.updateVisualization();
            });
        });
        
        // Handle node type filters
        const nodeFilters = document.querySelectorAll('input[name="nodeFilter"]');
        nodeFilters.forEach(checkbox => {
            checkbox.addEventListener('change', (event) => {
                console.log(`Filter ${event.target.value} ${event.target.checked ? 'enabled' : 'disabled'}`);
                
                if (event.target.checked) {
                    this.enabledNodeTypes.add(event.target.value);
                } else {
                    this.enabledNodeTypes.delete(event.target.value);
                }
                
                console.log('Enabled types:', Array.from(this.enabledNodeTypes));
                this.applyNodeFilters();
            });
        });
    }

    setupEventListeners() {
        // Double-click to reset selection
        this.svg.on('dblclick.reset', () => {
            this.clearHighlights();
        });
        
        // Single-click on background to clear selection
        this.svg.on('click.background', (event) => {
            // Only clear if clicking on the background (not on nodes or links)
            if (event.target === this.svg.node() || event.target === this.g.node()) {
                this.clearHighlights();
            }
        });
    }

    async loadProject(files) {
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        const stats = document.getElementById('stats');
        
        try {
            loading.style.display = 'block';
            error.textContent = '';
            
            // Generate project signature for cache validation
            const projectSignature = this.generateProjectSignature(files);
            
            // Check if we have cached data for this project
            if (this.cachedData && this.cachedProjectPath === projectSignature) {
                console.log('Using cached project data');
                this.renderGraph(this.cachedData);
                this.updateStats(this.cachedData.stats);
                return;
            }
            
            // Parse files if not cached or project changed
            const data = await this.parser.parseFiles(files);
            
            // Cache the data
            this.cachedData = data;
            this.cachedProjectPath = projectSignature;
            this.saveCacheToStorage();
            
            this.renderGraph(data);
            this.updateStats(data.stats);
            
            // Initialize debug exporter after loading data
            this.initializeDebugExporter();
            
        } catch (err) {
            error.textContent = err.message;
            console.error('Error loading project:', err);
        } finally {
            loading.style.display = 'none';
        }
    }

    renderGraph(data) {
        // Clear existing graph
        this.g.selectAll('*').remove();
        
        // Store original data (deep copy to prevent mutation)
        this.allNodes = JSON.parse(JSON.stringify(data.nodes));
        this.allLinks = JSON.parse(JSON.stringify(data.links));
        
        console.log(`Stored ${this.allNodes.length} nodes and ${this.allLinks.length} links`);
        
        // Apply current filters
        this.applyNodeFilters();
        
        // Create color scale for groups
        const groups = [...new Set(this.nodes.map(d => d.group))];
        this.colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(groups);
        
        // Create force simulation
        this.createSimulation();
        
        // Create links
        this.linkElements = this.g.append('g')
            .attr('class', 'links')
            .selectAll('line')
            .data(this.links)
            .enter().append('line')
            .attr('class', 'link');
        
        // Create nodes
        this.nodeElements = this.g.append('g')
            .attr('class', 'nodes')
            .selectAll('circle')
            .data(this.nodes)
            .enter().append('circle')
            .attr('class', 'node')
            .attr('r', d => this.getNodeRadius(d))
            .attr('fill', d => this.colorScale(d.group))
            .on('click', (event, d) => this.handleNodeClick(event, d))
            .call(d3.drag()
                .on('start', (event, d) => this.dragStarted(event, d))
                .on('drag', (event, d) => this.dragged(event, d))
                .on('end', (event, d) => this.dragEnded(event, d)));
        
        // Create labels for all nodes
        this.labelElements = this.g.append('g')
            .attr('class', 'labels')
            .selectAll('text')
            .data(this.nodes) // Show labels for all nodes
            .enter().append('text')
            .attr('class', 'node-label')
            .text(d => d.name)
            .attr('dy', '.35em')
            .style('font-size', d => this.getFontSize(d) + 'px');
        
        // Add tooltips with incoming/outgoing info
        this.nodeElements
            .on('mouseover', (event, d) => {
                const outgoing = d.references.length;
                const incoming = this.links.filter(l => {
                    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
                    return targetId === d.id;
                }).length;
                
                const tooltipText = `${d.name}\nPath: ${d.path}\nOutgoing: ${outgoing} dependencies\nIncoming: ${incoming} dependents\nTotal: ${outgoing + incoming} connections`;
                
                // Create or update tooltip
                let tooltip = d3.select('body').select('.node-tooltip');
                if (tooltip.empty()) {
                    tooltip = d3.select('body').append('div')
                        .attr('class', 'node-tooltip')
                        .style('position', 'absolute')
                        .style('background', 'rgba(0, 0, 0, 0.9)')
                        .style('color', 'white')
                        .style('padding', '8px 12px')
                        .style('border-radius', '4px')
                        .style('font-size', '12px')
                        .style('font-family', 'monospace')
                        .style('pointer-events', 'none')
                        .style('z-index', '1000')
                        .style('white-space', 'pre-line')
                        .style('box-shadow', '0 2px 8px rgba(0,0,0,0.3)')
                        .style('opacity', 0)
                        .style('transition', 'opacity 0.1s');
                }
                
                tooltip
                    .text(tooltipText)
                    .style('opacity', 1);
            })
            .on('mousemove', (event) => {
                d3.select('body').select('.node-tooltip')
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', () => {
                d3.select('body').select('.node-tooltip')
                    .style('opacity', 0);
            });
        
        // Start simulation
        this.simulation.nodes(this.nodes);
        this.simulation.force('link').links(this.links);
        this.simulation.alpha(1).restart();
    }

    createSimulation() {
        const linkDistance = Math.min(100, Math.max(30, 1000 / Math.sqrt(this.nodes.length)));
        const chargeStrength = Math.min(-30, -300 / Math.sqrt(this.nodes.length));
        
        this.simulation = d3.forceSimulation()
            .force('link', d3.forceLink()
                .id(d => d.id)
                .distance(linkDistance)
                .strength(0.1))
            .force('charge', d3.forceManyBody()
                .strength(chargeStrength))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', this.enableCollision ? 
                d3.forceCollide().radius(d => this.getNodeRadius(d) + 2) : null)
            .on('tick', () => this.ticked());
        
        // Configure simulation to run longer/continuously
        this.simulation
            .alphaDecay(0.0228) // Normal cooling rate (same as default)
            .velocityDecay(0.9) // Normal friction (same as default)
            .alphaMin(0.0001); // Much lower threshold - simulation runs much longer
        
        // For very large graphs, use slightly lower threshold
        if (this.nodes.length > 100) {
            this.simulation
                .alphaMin(0.00005); // Even lower threshold for large graphs
        }
    }

    ticked() {
        // Update link positions
        this.linkElements
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        // Update node positions
        this.nodeElements
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);
        
        // Update label positions (only for visible labels)
        this.labelElements
            .attr('x', d => d.x)
            .attr('y', d => d.y);
    }

    getNodeRadius(node) {
        // Size based on selected dependency mode (same logic as getFontSize)
        const outgoing = node.references.length;
        const incoming = this.links.filter(l => {
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;
            return targetId === node.id;
        }).length;
        
        let connectionCount;
        switch (this.dependencyMode) {
            case 'outgoing':
                connectionCount = outgoing;
                break;
            case 'incoming':
                connectionCount = incoming;
                break;
            case 'both':
            default:
                connectionCount = outgoing + incoming;
                break;
        }
        
        // Base radius: 4px, scale up with connections
        // Min: 4px, Max: 20px for better visibility
        const radius = Math.max(4, Math.min(400, 4 + connectionCount * 1.2));
        
        // Debug logging for nodes with no visible links
        if (connectionCount > 0 && Math.random() < 0.05) { // Log 5% of non-zero nodes
            console.log(`Node ${node.name}: outgoing=${outgoing}, incoming=${incoming}, mode=${this.dependencyMode}, connectionCount=${connectionCount}, radius=${radius}`);
        }
        
        return radius;
    }

    getFontSize(node) {
        // Calculate font size based on selected dependency mode
        const outgoing = node.references.length;
        const incoming = this.links.filter(l => {
            const targetId = typeof l.target === 'object' ? l.target.id : l.target;
            return targetId === node.id;
        }).length;
        
        let connectionCount;
        switch (this.dependencyMode) {
            case 'outgoing':
                connectionCount = outgoing;
                break;
            case 'incoming':
                connectionCount = incoming;
                break;
            case 'both':
            default:
                connectionCount = outgoing + incoming;
                break;
        }
        
        // Base font size: 2px, scale up with connections
        // Min: 2px, Max: 16px
        const baseFontSize = 2;
        const maxFontSize = 16;
        const scaleFactor = 0.3; // How much each connection increases font size
        
        const calculatedSize = baseFontSize + (connectionCount * scaleFactor);
        return Math.max(baseFontSize, Math.min(maxFontSize, calculatedSize));
    }

    handleNodeClick(event, node) {
        event.stopPropagation();
        
        if (this.selectedNode === node) {
            this.clearHighlights();
            return;
        }
        
        this.selectedNode = node;
        this.highlightDependencies(node);
    }

    highlightDependencies(node) {
        // Clear previous highlights
        this.clearHighlights();
        
        // Find all related nodes and links based on current mode
        const relatedNodes = new Set([node.id]);
        const relatedLinks = new Set();
        
        this.links.forEach(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            
            // Check outgoing dependencies (this node depends on others)
            if (sourceId === node.id && (this.dependencyMode === 'outgoing' || this.dependencyMode === 'both')) {
                relatedNodes.add(targetId);
                relatedLinks.add(link);
            }
            
            // Check incoming dependencies (others depend on this node)
            if (targetId === node.id && (this.dependencyMode === 'incoming' || this.dependencyMode === 'both')) {
                relatedNodes.add(sourceId);
                relatedLinks.add(link);
            }
        });
        
        // Apply highlights and visibility based on mode
        this.nodeElements
            .classed('highlighted', d => d.id === node.id)
            .classed('dependency', d => relatedNodes.has(d.id) && d.id !== node.id)
            .style('opacity', d => {
                if (this.dependencyMode === 'both') {
                    return relatedNodes.has(d.id) ? 1 : 0.3;
                } else {
                    return relatedNodes.has(d.id) ? 1 : 0.1;
                }
            });
        
        // Show only connections that match the selected mode
        this.linkElements
            .style('opacity', d => {
                const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
                const targetId = typeof d.target === 'object' ? d.target.id : d.target;
                
                if (this.dependencyMode === 'outgoing') {
                    return sourceId === node.id ? 1 : 0;
                } else if (this.dependencyMode === 'incoming') {
                    return targetId === node.id ? 1 : 0;
                } else {
                    return (sourceId === node.id || targetId === node.id) ? 1 : 0.2;
                }
            })
            .classed('highlighted', d => {
                const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
                const targetId = typeof d.target === 'object' ? d.target.id : d.target;
                
                if (this.dependencyMode === 'outgoing') {
                    return sourceId === node.id;
                } else if (this.dependencyMode === 'incoming') {
                    return targetId === node.id;
                } else {
                    return sourceId === node.id || targetId === node.id;
                }
            });
    }

    clearHighlights() {
        this.selectedNode = null;
        this.nodeElements
            .classed('highlighted', false)
            .classed('dependency', false)
            .style('opacity', 1);
        this.linkElements
            .classed('highlighted', false)
            .classed('dependency', false)
            .style('opacity', 1);
    }

    updateVisualization() {
        if (!this.labelElements || !this.nodes) return;
        
        // Update font sizes based on new dependency mode
        this.labelElements
            .transition()
            .duration(300)
            .style('font-size', d => this.getFontSize(d) + 'px');
        
        // Update node sizes based on new dependency mode
        this.nodeElements
            .transition()
            .duration(300)
            .attr('r', d => this.getNodeRadius(d));
        
        // Restart simulation to accommodate new node sizes
        this.simulation
            .alpha(0.3) // Add some energy to restart the simulation
            .restart();
        
  
        console.log(`Switched to ${this.dependencyMode} dependency mode`);
    }

    // Drag handlers
    dragStarted(event, d) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
    }

    dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    dragEnded(event, d) {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
    }

    handleResize() {
        const container = document.querySelector('.visualization-container');
        const rect = container.getBoundingClientRect();
        
        this.width = rect.width;
        this.height = rect.height;
        
        this.svg.attr('width', this.width).attr('height', this.height);
        
        if (this.simulation) {
            this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
            this.simulation.alpha(0.3).restart();
        }
    }

    // Cache Management Methods
    generateProjectSignature(files) {
        // Create a signature based on file names and count for cache validation
        const asmdefFiles = Array.from(files).filter(file => file.name.endsWith('.asmdef'));
        const fileNames = asmdefFiles.map(f => f.webkitRelativePath || f.name).sort();
        return `${fileNames.length}_${fileNames.join('|')}`;
    }

    loadCachedData() {
        try {
            const cached = localStorage.getItem(this.cacheKey);
            if (cached) {
                const parsedCache = JSON.parse(cached);
                this.cachedData = parsedCache.data;
                this.cachedProjectPath = parsedCache.projectPath;
                
                // If we have cached data, show it immediately
                if (this.cachedData) {
                    console.log('Loaded cached project data from localStorage');
            this.renderGraph(this.cachedData);
            this.updateStats(this.cachedData.stats);
            
            // Show controls since we have a loaded project
            this.showControls();
            this.showNodeFilters();
            
            // Initialize debug exporter
            this.initializeDebugExporter();
                }
            }
        } catch (error) {
            console.warn('Failed to load cached data:', error);
            this.clearCache();
        }
    }

    saveCacheToStorage() {
        try {
            const cacheData = {
                data: this.cachedData,
                projectPath: this.cachedProjectPath,
                timestamp: Date.now()
            };
            localStorage.setItem(this.cacheKey, JSON.stringify(cacheData));
            console.log('Project data cached to localStorage');
        } catch (error) {
            console.warn('Failed to save cache to localStorage:', error);
        }
    }

    clearCache() {
        this.cachedData = null;
        this.cachedProjectPath = null;
        localStorage.removeItem(this.cacheKey);
        console.log('Cache cleared');
    }

    // File-based cache methods
    saveCacheToFile() {
        if (!this.cachedData) {
            alert('No cached data to save. Please load a project first.');
            return;
        }

        const cacheData = {
            version: this.fileCacheVersion,
            data: this.cachedData,
            projectPath: this.cachedProjectPath,
            timestamp: Date.now(),
            stats: this.cachedData.stats
        };

        const blob = new Blob([JSON.stringify(cacheData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `asmdef_cache_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log('Cache saved to file');
    }

    loadCacheFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const cacheData = JSON.parse(e.target.result);
                    
                    // Validate cache format
                    if (!cacheData.version || !cacheData.data || !cacheData.projectPath) {
                        throw new Error('Invalid cache file format');
                    }

                    // Check version compatibility
                    if (cacheData.version !== this.fileCacheVersion) {
                        console.warn(`Cache version mismatch. Expected ${this.fileCacheVersion}, got ${cacheData.version}`);
                    }

                    // Load the cached data
                    this.cachedData = cacheData.data;
                    this.cachedProjectPath = cacheData.projectPath;
                    
                    // Render the graph
                    this.renderGraph(this.cachedData);
                    this.updateStats(this.cachedData.stats);
                    
                    // Show controls since we have a loaded project
                    this.showControls();
                    this.showNodeFilters();
                    
                    // Initialize debug exporter
                    this.initializeDebugExporter();
                    
                    console.log('Cache loaded from file successfully');
                    alert(`Cache loaded successfully!\nProject: ${cacheData.projectPath}\nStats: ${cacheData.stats.totalAsmdefs} asmdefs, ${cacheData.stats.totalDependencies} dependencies`);
                    
                } catch (error) {
                    console.error('Failed to load cache file:', error);
                    alert('Failed to load cache file: ' + error.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }

    updateStats(stats) {
        const statsElement = document.getElementById('stats');
        const statsText = `${stats.totalAsmdefs} asmdefs, ${stats.totalDependencies} dependencies`;
        statsElement.textContent = statsText;
    }

    showControls() {
        // Show all control elements
        const reloadBtn = document.getElementById('reloadBtn');
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        const saveCacheBtn = document.getElementById('saveCacheBtn');
        const loadCacheBtn = document.getElementById('loadCacheBtn');
        const dependencyToggle = document.getElementById('dependencyToggle');
        
        if (reloadBtn) reloadBtn.style.display = 'inline-block';
        if (clearCacheBtn) clearCacheBtn.style.display = 'inline-block';
        if (saveCacheBtn) saveCacheBtn.style.display = 'inline-block';
        if (loadCacheBtn) loadCacheBtn.style.display = 'inline-block';
        if (dependencyToggle) dependencyToggle.style.display = 'flex';
    }

    showNodeFilters() {
        const nodeFilters = document.getElementById('nodeFilters');
        if (nodeFilters) nodeFilters.style.display = 'flex';
    }

    applyNodeFilters() {
        // Always start from original data
        this.nodes = [...this.allNodes.filter(node => this.enabledNodeTypes.has(node.group))];
        
        // Get set of enabled node IDs for link filtering
        const enabledNodeIds = new Set(this.nodes.map(n => n.id));
        
        // Filter links to only include connections between enabled nodes
        // Always start from original links
        this.links = [...this.allLinks.filter(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            return enabledNodeIds.has(sourceId) && enabledNodeIds.has(targetId);
        })];
        
        // If we have existing visualization, update it
        if (this.g && this.nodes.length > 0) {
            this.updateFilteredVisualization();
        }
        
        console.log(`Filtered to ${this.nodes.length} nodes and ${this.links.length} links (from ${this.allNodes.length} total nodes, ${this.allLinks.length} total links)`);
        
        // Debug: Check if we have the expected groups
        const nodeGroups = [...new Set(this.nodes.map(n => n.group))];
        const allGroups = [...new Set(this.allNodes.map(n => n.group))];
        console.log('Available groups in filtered nodes:', nodeGroups);
        console.log('All groups in original data:', allGroups);
    }

    // Debug method to check data integrity
    debugDataState() {
        console.group('🔍 Data State Debug');
        console.log('Original nodes:', this.allNodes?.length || 0);
        console.log('Original links:', this.allLinks?.length || 0);
        console.log('Filtered nodes:', this.nodes?.length || 0);
        console.log('Filtered links:', this.links?.length || 0);
        console.log('Enabled types:', Array.from(this.enabledNodeTypes));
        
        if (this.allNodes && this.allNodes.length > 0) {
            const groupCounts = {};
            this.allNodes.forEach(node => {
                groupCounts[node.group] = (groupCounts[node.group] || 0) + 1;
            });
            console.log('Original group counts:', groupCounts);
        }
        
        console.groupEnd();
    }

    updateFilteredVisualization() {
        // Clear existing elements
        this.g.selectAll('*').remove();
        
        // Recreate color scale for filtered groups
        const groups = [...new Set(this.nodes.map(d => d.group))];
        this.colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(groups);
        
        // Create force simulation
        this.createSimulation();
        
        // Create links
        this.linkElements = this.g.append('g')
            .attr('class', 'links')
            .selectAll('line')
            .data(this.links)
            .enter().append('line')
            .attr('class', 'link');
        
        // Create nodes
        this.nodeElements = this.g.append('g')
            .attr('class', 'nodes')
            .selectAll('circle')
            .data(this.nodes)
            .enter().append('circle')
            .attr('class', 'node')
            .attr('r', d => this.getNodeRadius(d))
            .attr('fill', d => this.colorScale(d.group))
            .on('click', (event, d) => this.handleNodeClick(event, d))
            .call(d3.drag()
                .on('start', (event, d) => this.dragStarted(event, d))
                .on('drag', (event, d) => this.dragged(event, d))
                .on('end', (event, d) => this.dragEnded(event, d)));
        
        // Create labels for all nodes
        this.labelElements = this.g.append('g')
            .attr('class', 'labels')
            .selectAll('text')
            .data(this.nodes)
            .enter().append('text')
            .attr('class', 'node-label')
            .text(d => d.name)
            .attr('dy', '.35em')
            .style('font-size', d => this.getFontSize(d) + 'px');
        
        // Add tooltips with incoming/outgoing info
        this.nodeElements
            .on('mouseover', (event, d) => {
                const outgoing = d.references.length;
                const incoming = this.links.filter(l => {
                    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
                    return targetId === d.id;
                }).length;
                
                const tooltipText = `${d.name}\nPath: ${d.path}\nOutgoing: ${outgoing} dependencies\nIncoming: ${incoming} dependents\nTotal: ${outgoing + incoming} connections`;
                
                // Create or update tooltip
                let tooltip = d3.select('body').select('.node-tooltip');
                if (tooltip.empty()) {
                    tooltip = d3.select('body').append('div')
                        .attr('class', 'node-tooltip')
                        .style('position', 'absolute')
                        .style('background', 'rgba(0, 0, 0, 0.9)')
                        .style('color', 'white')
                        .style('padding', '8px 12px')
                        .style('border-radius', '4px')
                        .style('font-size', '12px')
                        .style('font-family', 'monospace')
                        .style('pointer-events', 'none')
                        .style('z-index', '1000')
                        .style('white-space', 'pre-line')
                        .style('box-shadow', '0 2px 8px rgba(0,0,0,0.3)')
                        .style('opacity', 0)
                        .style('transition', 'opacity 0.1s');
                }
                
                tooltip
                    .text(tooltipText)
                    .style('opacity', 1);
            })
            .on('mousemove', (event) => {
                d3.select('body').select('.node-tooltip')
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 10) + 'px');
            })
            .on('mouseout', () => {
                d3.select('body').select('.node-tooltip')
                    .style('opacity', 0);
            });
        
        // Start simulation
        this.simulation.nodes(this.nodes);
        this.simulation.force('link').links(this.links);
        this.simulation.alpha(1).restart();
    }

    initializeDebugExporter() {
        if (!this.debugExporter && window.DebugExporter) {
            this.debugExporter = new DebugExporter(this);
            this.debugExporter.showDebugControls();
            
            // Log summary to console automatically
            setTimeout(() => {
                this.debugExporter.logSummary();
            }, 1000);
        }
    }

    // Public method to reload project (bypass cache)
    reloadProject() {
        const folderInput = document.getElementById('folderInput');
        if (folderInput.files && folderInput.files.length > 0) {
            this.clearCache();
            this.loadProject(folderInput.files);
        }
    }
}

// Initialize the visualizer when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.visualizer = new AsmdefVisualizer();
    
    // Expose debug method globally
    window.debugFilters = () => {
        if (window.visualizer) {
            window.visualizer.debugDataState();
        }
    };
});
