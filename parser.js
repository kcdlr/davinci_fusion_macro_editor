// parser.js

/**
 * A helper function to safely find the content within a matched pair of braces {}.
 * @param {string} content The string to search within.
 * @param {string} blockStartMarker The text immediately preceding the opening brace.
 * @param {number} startIndex The position in the content to start searching from.
 * @returns {{content: string, startIndex: number, endIndex: number}|null}
 */
function findBlockContent(content, blockStartMarker, startIndex = 0) {
    const startMarkerIndex = content.indexOf(blockStartMarker, startIndex);
    if (startMarkerIndex === -1) return null;

    const blockContentStartIndex = startMarkerIndex + blockStartMarker.length;
    let braceDepth = 1;
    let blockEndIndex = -1;

    for (let i = blockContentStartIndex; i < content.length; i++) {
        if (content[i] === '{') braceDepth++;
        else if (content[i] === '}') {
            braceDepth--;
            if (braceDepth === 0) {
                blockEndIndex = i;
                break;
            }
        }
    }
    if (blockEndIndex === -1) return null;

    return {
        content: content.substring(blockContentStartIndex, blockEndIndex),
        startIndex: startMarkerIndex,
        endIndex: blockEndIndex + 1
    };
}

function findTopLevelBlock(body, header) {
    if (!body) return null;
    let depth = 0;
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);

        if (depth === 0 && body.startsWith(header, i)) {
            const bracePos = body.indexOf('{', i + header.length - 1);
            if (bracePos === -1) return null;
            let d = 1;
            let j = bracePos + 1;
            while (j < body.length && d > 0) {
                const cj = body[j];
                if (cj === '{') d++;
                else if (cj === '}') d--;
                j++;
            }
            if (d === 0) {
                return {
                    content: body.substring(bracePos + 1, j - 1),
                    startIndex: i,
                    endIndex: j
                };
            } else {
                return null;
            }
        }
    }
    return null;
}

/**
 * Parses the .setting file using a robust, multi-pass approach.
 * @param {string} content The string content of the .setting file.
 * @returns {object} An object containing the reconstructed tree and other macro metadata.
 */
export function parseSettingFile(content) {
    let nextId = 0;
    const root = { id: nextId++, type: 'ROOT', children: [], parent: null };

    // Match either “GroupOperator” or “MacroOperator” so the parser works for both types
    // Capture both the operator name and its type (GroupOperator or MacroOperator)
    const groupOperatorMatch = content.match(/(\w+)\s*=\s*(GroupOperator|MacroOperator)\s*{/);
    const mainOperatorName = groupOperatorMatch ? groupOperatorMatch[1] : 'MyMacro';
    const mainOperatorType = groupOperatorMatch ? groupOperatorMatch[2] : 'GroupOperator';
    const groupOperatorStartIndex = groupOperatorMatch ? groupOperatorMatch.index : 0;
    const groupOpenHeader = `${mainOperatorName} = ${mainOperatorType} {`;
    const groupBlock = findBlockContent(content, groupOpenHeader, groupOperatorStartIndex);
    const groupBody = groupBlock ? groupBlock.content : content.substring(groupOperatorStartIndex);

    // --- Pass 1: Create a flat list of all InstanceInputs and Page Comments ---
    const flatList = [];
    const inputsBlock = findTopLevelBlock(groupBody, "Inputs = ordered() {");

    if (inputsBlock) {
        const lineRegex = /^\s*(-- ▼▼▼ ページ:.*|([a-zA-Z0-9_]+)\s*=\s*InstanceInput\s*{)/gm;
        let lineMatch;
        while ((lineMatch = lineRegex.exec(inputsBlock.content)) !== null) {
            if (lineMatch[1].startsWith('--')) {
                const pageNameMatch = lineMatch[1].match(/-- ▼▼▼ ページ:\s*(.+)\s*▼▼▼/);
                if (pageNameMatch) {
                    flatList.push({ type: 'PAGE_MARKER', name: pageNameMatch[1].trim() });
                }
            } else {
                const key = lineMatch[2];
                const blockStart = lineMatch.index + lineMatch[0].length - 1;
                const controlContent = findBlockContent(inputsBlock.content, "{", blockStart);
                if (!controlContent) continue;

                const fullOriginalBlock = inputsBlock.content.substring(lineMatch.index, controlContent.endIndex).trim();
                const properties = {};
                const propsRegex = /(\w+)\s*=\s*(?:"([^"]*)"|({[^}]*})|([^,}\s]+))/g;
                let propMatch;
                while((propMatch = propsRegex.exec(controlContent.content)) !== null){
                    properties[propMatch[1]] = propMatch[2] || propMatch[3] || propMatch[4];
                }
                flatList.push({ type: 'CONTROL_DATA', key, properties, originalBlock: fullOriginalBlock });
            }
        }
    }

    // --- Pass 2: Read the helper node metadata, including LBLC_NumInputs ---
    const metadataMap = new Map();
    const toolsBlock = findTopLevelBlock(groupBody, "Tools = ordered() {");
    const originalTools = toolsBlock ? toolsBlock.content : '';
    const helperBlock = findBlockContent(originalTools, "background_helper = Background {");

    if (helperBlock) {
        const userControlsBlock = findBlockContent(helperBlock.content, "UserControls = ordered() {");
        if (userControlsBlock) {
            const controlRegex = /(AutoLabel\d+)\s*=\s*{([^}]+)}/g;
            let controlMatch;
            while((controlMatch = controlRegex.exec(userControlsBlock.content)) !== null) {
                const key = controlMatch[1];
                const propertiesText = controlMatch[2];
                const nameMatch = propertiesText.match(/LINKS_Name\s*=\s*"([^"]+)"/);
                const nestLevelMatch = propertiesText.match(/LBLC_NestLevel\s*=\s*(\d+)/);
                const numInputsMatch = propertiesText.match(/LBLC_NumInputs\s*=\s*(\d+)/); // <-- Extract LBLC_NumInputs

                if (nameMatch && nestLevelMatch && numInputsMatch) {
                    metadataMap.set(key, {
                        name: nameMatch[1],
                        nestLevel: parseInt(nestLevelMatch[1], 10),
                        childCount: parseInt(numInputsMatch[1], 10) // <-- Store the child count
                    });
                }
            }
        }
    }

    // --- Pass 3: Reconstruct the tree using a recursive function ---
    function buildTreeRecursive(parent, items) {
        while (items.length > 0) {
            const item = items.shift(); // Take the next item from the list

            if (item.type === 'PAGE_MARKER') {
                const pageNode = { id: nextId++, type: 'PAGE', name: item.name, parent: root, children: [] };
                root.children.push(pageNode);
                continue; // Continue processing siblings
            }

            if (item.type === 'CONTROL_DATA') {
                const isGroup = metadataMap.has(item.properties.Source);
                if (isGroup) {
                    const metadata = metadataMap.get(item.properties.Source);
                    const groupNode = {
                        id: nextId++,
                        type: 'GROUP',
                        name: metadata.name,
                        internalKey: item.properties.Source,
                        parent: parent,
                        children: [],
                        data: { key: item.key, originalBlock: item.originalBlock, properties: item.properties }
                    };
                    parent.children.push(groupNode);

                    // Take the next `childCount` items and build the sub-tree recursively
                    const childrenToProcess = items.splice(0, metadata.childCount);
                    buildTreeRecursive(groupNode, childrenToProcess);

                } else { // It's a standard control
                    const controlNode = {
                        id: nextId++,
                        type: 'CONTROL',
                        data: { key: item.key, originalBlock: item.originalBlock, properties: item.properties },
                        parent: parent,
                        children: []
                    };
                    parent.children.push(controlNode);
                }
            }
        }
    }

    buildTreeRecursive(root, flatList);

    return { tree: root, mainOperatorName, mainOperatorType, originalTools };
}
