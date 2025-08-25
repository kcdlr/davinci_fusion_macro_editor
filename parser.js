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
        let currentPageName = "Controls"; // デフォルトは"Controls"

        // Regex to find InstanceInput blocks
        const instanceInputRegex = /([a-zA-Z0-9_]+)\s*=\s*InstanceInput\s*{/g;
        let inputMatch;

        // まず、すべてのコントロールデータを収集
        const allControlData = [];
        while ((inputMatch = instanceInputRegex.exec(inputsBlock.content)) !== null) {
            const key = inputMatch[1];
            const blockStart = inputMatch.index + inputMatch[0].length - 1;
            const controlContent = findBlockContent(inputsBlock.content, "{", blockStart);
            if (!controlContent) continue;

            const fullOriginalBlock = inputsBlock.content.substring(inputMatch.index, controlContent.endIndex).trim();
            const properties = {};
            const propsRegex = /(\w+)\s*=\s*(?:"([^"]*)"|({[^}]*})|([^,}\s]+))/g;
            let propMatch;
            while((propMatch = propsRegex.exec(controlContent.content)) !== null){
                properties[propMatch[1]] = propMatch[2] || propMatch[3] || propMatch[4];
            }
            allControlData.push({ type: 'CONTROL_DATA', key, properties, originalBlock: fullOriginalBlock });
        }

        // 収集したコントロールデータに基づいてPAGE_MARKERを挿入
        let firstControl = true;
        for (const item of allControlData) {
            const pageProperty = item.properties.Page; // 'Page'プロパティをチェック

            if (firstControl) {
                // 最初のコントロールの処理
                if (pageProperty && pageProperty !== "Controls") {
                    currentPageName = pageProperty;
                    flatList.push({ type: 'PAGE_MARKER', name: currentPageName });
                } else {
                    // Pageプロパティがないか"Controls"の場合は、currentPageNameは"Controls"のまま
                    // マーカーは挿入しない
                }
                firstControl = false;
            } else {
                // 後続のコントロールの処理
                if (pageProperty && pageProperty !== currentPageName) {
                    // 新しいPageプロパティがあり、現在のページ名と異なる場合
                    flatList.push({ type: 'PAGE_MARKER', name: pageProperty });
                    currentPageName = pageProperty;
                }
                // Pageプロパティがない場合、または現在のページ名と同じ場合は、ページマーカーを挿入しない
                // currentPageNameも変更しない（一度設定されたページは明示的に変更されるまで維持される）
            }

            // Pageプロパティを削除
            if (item.properties.Page) {
                delete item.properties.Page;
            }

            flatList.push(item); // コントロールデータ自体を追加
        }
    }

    // --- Pass 2: Read the helper node metadata, including LBLC_NumInputs ---
const metadataMap = new Map();
let maxAutoLabelIndex = 0;
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
                const numCap = key.match(/AutoLabel(\d+)/);
                if (numCap) {
                    const n = parseInt(numCap[1], 10);
                    if (!isNaN(n)) maxAutoLabelIndex = Math.max(maxAutoLabelIndex, n);
                }
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
                    const isMainInput = /^MainInput\d+$/i.test(item.key);
                    const controlNode = {
                        id: nextId++,
                        type: 'CONTROL',
                        data: { key: item.key, originalBlock: item.originalBlock, properties: item.properties },
                        parent: parent,
                        children: [],
                        hidden: isMainInput
                    };
                    parent.children.push(controlNode);
                }
            }
        }
    }

    buildTreeRecursive(root, flatList);

    return { tree: root, mainOperatorName, mainOperatorType, originalTools, maxAutoLabelIndex };
}
