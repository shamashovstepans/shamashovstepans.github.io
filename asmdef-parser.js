/**
 * Unity Asmdef Parser
 * Parses .asmdef files and extracts dependency information
 */

class AsmdefParser {
    constructor() {
        this.asmdefs = new Map();
        this.dependencies = [];
        this.guidToName = new Map(); // GUID -> assembly name mapping
        this.nameToGuid = new Map(); // assembly name -> GUID mapping
    }

    /**
     * Parse files from a directory input
     * @param {FileList} files - Files from directory input
     * @returns {Promise<Object>} Parsed data with nodes and links
     */
    async parseFiles(files) {
        this.asmdefs.clear();
        this.dependencies = [];
        this.guidToName.clear();
        this.nameToGuid.clear();

        console.log(`Parsing ${files.length} files`);

        const asmdefFiles = Array.from(files).filter(file => 
            file.name.endsWith('.asmdef')
        );
        
        const metaFiles = Array.from(files).filter(file => 
            file.name.endsWith('.asmdef.meta')
        );

        if (asmdefFiles.length === 0) {
            throw new Error('No .asmdef files found in the selected directory');
        }

        console.log(`Found ${asmdefFiles.length} .asmdef files and ${metaFiles.length} .meta files`);

        // First, parse all .meta files to build GUID mappings
        const metaPromises = metaFiles.map(file => this.parseMetaFile(file));
        await Promise.all(metaPromises);

        // Then parse all asmdef files
        const parsePromises = asmdefFiles.map(file => this.parseAsmdefFile(file));
        await Promise.all(parsePromises);

        // Build dependency graph
        return this.buildDependencyGraph();
    }

    /**
     * Parse a single .asmdef.meta file to extract GUID
     * @param {File} file - The .asmdef.meta file
     * @returns {Promise<void>}
     */
    async parseMetaFile(file) {
        try {
            const content = await this.readFileContent(file);
            const lines = content.split('\n');
            
            let guid = null;
            
            // Look for the guid line in the meta file
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('guid:') || trimmedLine.startsWith('GUID:')) {
                    guid = trimmedLine.split(':')[1].trim();
                    break;
                }
            }
            
            if (guid) {
                // Extract assembly name from the file path
                // Remove .meta extension and .asmdef extension to get the assembly name
                const asmdefFileName = file.name.replace('.meta', '');
                const assemblyName = asmdefFileName.replace('.asmdef', '');
                
                this.guidToName.set(guid, assemblyName);
                this.nameToGuid.set(assemblyName, guid);
                
                console.log(`Mapped GUID ${guid} -> ${assemblyName}`);
            }
            else {
                console.warn(`No GUID found in meta file ${file.name}`);
            }
        } catch (error) {
            console.warn(`Failed to parse meta file ${file.name}:`, error);
        }
    }

    /**
     * Parse a single .asmdef file
     * @param {File} file - The .asmdef file
     * @returns {Promise<void>}
     */
    async parseAsmdefFile(file) {
        try {
            const content = await this.readFileContent(file);
            const asmdefData = JSON.parse(content);
            
            const asmdef = {
                name: asmdefData.name || file.name.replace('.asmdef', ''),
                path: file.webkitRelativePath || file.name,
                references: asmdefData.references || [],
                includePlatforms: asmdefData.includePlatforms || [],
                excludePlatforms: asmdefData.excludePlatforms || [],
                allowUnsafeCode: asmdefData.allowUnsafeCode || false,
                overrideReferences: asmdefData.overrideReferences || false,
                precompiledReferences: asmdefData.precompiledReferences || [],
                autoReferenced: asmdefData.autoReferenced !== false, // default true
                defineConstraints: asmdefData.defineConstraints || [],
                versionDefines: asmdefData.versionDefines || [],
                noEngineReferences: asmdefData.noEngineReferences || false
            };

            this.asmdefs.set(asmdef.name, asmdef);
        } catch (error) {
            console.warn(`Failed to parse ${file.name}:`, error);
        }
    }

    /**
     * Read file content as text
     * @param {File} file - The file to read
     * @returns {Promise<string>}
     */
    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    /**
     * Build the dependency graph from parsed asmdefs
     * @returns {Object} Graph data with nodes and links
     */
    buildDependencyGraph() {
        const nodes = [];
        const links = [];
        const nodeMap = new Map();

        // Create nodes for all asmdefs
        for (const [name, asmdef] of this.asmdefs) {
            const node = {
                id: name,
                name: name,
                path: asmdef.path,
                group: this.getAsmdefGroup(asmdef),
                ...asmdef
            };
            nodes.push(node);
            nodeMap.set(name, node);
        }

        // Create links for dependencies
        for (const [name, asmdef] of this.asmdefs) {
            for (const reference of asmdef.references) {
                // Handle both direct names and GUID references
                const targetName = this.resolveReference(reference);
                
                if (targetName && this.asmdefs.has(targetName)) {
                    links.push({
                        source: name,
                        target: targetName,
                        type: 'dependency'
                    });
                    console.log(`Created link: ${name} -> ${targetName} (from reference: ${reference})`);
                } else {
                    console.warn(`Failed to resolve reference: ${reference} for assembly: ${name}`);
                }
            }
        }

        console.log(`GUID Resolution Summary:`);
        console.log(`- Mapped ${this.guidToName.size} GUIDs from .meta files`);
        console.log(`- Created ${links.length} dependency links`);
        
        return {
            nodes,
            links,
            stats: {
                totalAsmdefs: nodes.length,
                totalDependencies: links.length,
                groups: this.getGroupStats(nodes),
                guidMappings: this.guidToName.size
            }
        };
    }

    /**
     * Resolve a reference to an asmdef name
     * @param {string} reference - The reference (name or GUID)
     * @returns {string|null} The resolved asmdef name
     */
    resolveReference(reference) {
        // If it's already a direct name match
        if (this.asmdefs.has(reference)) {
            console.warn(`Direct name match GUID: ${reference}`);
            return reference;
        }

        // Handle GUID: prefix format
        let guidToResolve = reference;
        if (reference.startsWith('GUID:')) {
            guidToResolve = reference.substring(5); // Remove "GUID:" prefix
        }

        // Try to resolve by GUID (both with and without dashes)
        if (guidToResolve.match(/^[0-9a-f]{32}$/i) || guidToResolve.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
            const resolvedName = this.guidToName.get(guidToResolve);
            if (resolvedName) {
                console.log(`Resolved GUID ${reference} -> ${resolvedName}`);
                return resolvedName;
            } else {
                console.warn(`Unknown GUID: ${reference} (extracted: ${guidToResolve})`);
                return this.resolveUnknownGuid(reference);
            }
        }

        // Try partial matching for common Unity assemblies
        const unityAssemblies = [
            'UnityEngine',
            'UnityEditor',
            'Unity.Mathematics',
            'Unity.Collections',
            'Unity.Burst',
            'Unity.Jobs',
            'Unity.Entities',
            'Unity.Transforms',
            'Unity.Rendering.Hybrid'
        ];

        for (const unityAssembly of unityAssemblies) {
            if (reference.includes(unityAssembly)) {
                return unityAssembly;
            }
        }

        return reference; // Return as-is, might be external
    }

    /**
     * Try to resolve unknown GUIDs using common Unity assembly GUIDs
     * @param {string} guid - The GUID to resolve
     * @returns {string|null} The resolved assembly name or null
     */
    resolveUnknownGuid(guid) {
        // Common Unity assembly GUIDs (these are standard across Unity installations)
        const knownUnityGuids = {
            '1f55507f-a1df-4dc0-9eca-971f3b1b8d5e': 'UnityEngine.CoreModule',
            '4f231c4f-b2a4-4c5c-8b4e-6b3c8b4e6b3c': 'UnityEditor',
            'e0cd26848372d4e5c891c569017e11f1': 'Unity.Mathematics',
            '2665a8d13d1b3f18800f46e256720795': 'Unity.Collections',
            '8819f35a0fc84499b990e90a93806ab9': 'Unity.Burst',
            'a5baed0c9693541a5bd947d336ec7659': 'Unity.Jobs',
            // Add more as needed
        };

        const resolvedName = knownUnityGuids[guid.toLowerCase()];
        if (resolvedName) {
            console.log(`Resolved known Unity GUID ${guid} -> ${resolvedName}`);
            return resolvedName;
        }

        return null;
    }

    /**
     * Determine the group/category of an asmdef
     * @param {Object} asmdef - The asmdef data
     * @returns {string} The group name
     */
    getAsmdefGroup(asmdef) {
        const path = asmdef.path.toLowerCase();
        const name = asmdef.name.toLowerCase();

        if (name.includes('editor') || path.includes('editor')) {
            return 'Editor';
        }
        if (name.includes('test') || path.includes('test')) {
            return 'Tests';
        }
        if (name.includes('runtime') || path.includes('runtime')) {
            return 'Runtime';
        }
        if (name.startsWith('unity.') || name.includes('unity')) {
            return 'Unity';
        }
        if (path.includes('third') || path.includes('plugin')) {
            return 'Third Party';
        }
        
        return 'Game';
    }

    /**
     * Get statistics about groups
     * @param {Array} nodes - The nodes array
     * @returns {Object} Group statistics
     */
    getGroupStats(nodes) {
        const groups = {};
        for (const node of nodes) {
            groups[node.group] = (groups[node.group] || 0) + 1;
        }
        return groups;
    }
}

// Export for use in other scripts
window.AsmdefParser = AsmdefParser;
