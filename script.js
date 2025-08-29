// script.js
import { parseSettingFile } from './parser.js';
import { generateSettingFile } from './writer.js';

let tree = { id: 0, type: 'ROOT', children: [], parent: null };
let nodeMap = new Map();
let originalContent = '';
let originalFilename = 'macro.setting';
let mainOperatorName = 'MyMacro';
let mainOperatorType = 'GroupOperator';
let originalTools = '';
let maxAutoLabelIndex = 0;
let selectedIds = new Set();
let lastSelectedId = null;

const ui = {
    openBtn: document.getElementById('open-btn'),
    fileInput: document.getElementById('file-input'),
    controlsList: document.getElementById('controls-list'),
    groupBtn: document.getElementById('group-btn'),
    renameBtn: document.getElementById('rename-btn'),
    pageBtn: document.getElementById('page-btn'),
    deleteBtn: document.getElementById('delete-btn'),
    pasteBtn: document.getElementById('paste-btn'),
    outputBtn: document.getElementById('output-btn'),
    moveUpBtn: document.getElementById('move-up-btn'),
    moveDownBtn: document.getElementById('move-down-btn'),
    indentBtn: document.getElementById('indent-btn'),
    outdentBtn: document.getElementById('outdent-btn'),
    propertyEditor: document.getElementById('property-editor'),
    noSelection: document.getElementById('no-selection'),
    propName: document.getElementById('prop-name'),
    propType: document.getElementById('prop-type'),
    outputArea: document.getElementById('output-area'),
    outputText: document.getElementById('output-text'),
    copyOutputBtn: document.getElementById('copy-output-btn'),
    downloadOutputBtn: document.getElementById('download-output-btn'),
};

function addClickFeedback(button) {
    button.classList.add('clicked');
    setTimeout(() => {
        button.classList.remove('clicked');
    }, 200); // Remove the class after 200ms
}

function processInputContent(content, filename = 'clipboard_macro.setting') {
    try {
        originalContent = content;
        originalFilename = filename;
        const result = parseSettingFile(originalContent);
        // 解析結果が不正な場合にエラーを投げる
        if (!result || !result.tree) {
            throw new Error("Macro structure could not be parsed. Check if the file format is correct.");
        }
        tree = result.tree;
        mainOperatorName = result.mainOperatorName;
        mainOperatorType = result.mainOperatorType;
        originalTools = result.originalTools;
        maxAutoLabelIndex = result.maxAutoLabelIndex || 0;
        selectedIds.clear();
        lastSelectedId = null;
        render();
    } catch (error) {
        // ユーザー向けのアラートをより分かりやすくする
        alert(`読み込みに失敗しました。\n\n[エラー詳細]\n${error.message}`);
        // コンソールには詳細なエラーオブジェクトを出力する
        console.error('Error during input processing:', error);
    }
}

function buildNodeMap(node) {
    nodeMap.set(node.id, node);
    if (node.children) {
        node.children.forEach(buildNodeMap);
    }
}

function getFlatListForRender() {
    function flatten(node, depth = 0) {
        let list = [];
        if (node.type !== 'ROOT' && !node.hidden) { list.push({ ...node, depth }); }
        const childrenDepth = (node.type === 'GROUP') ? depth + 1 : depth;
        if (node.children) { node.children.forEach(child => { list = list.concat(flatten(child, childrenDepth)); }); }
        return list;
    }
    return flatten(tree);
}

const render = () => {
    ui.controlsList.innerHTML = '';
    nodeMap.clear();
    buildNodeMap(tree);
    const flatList = getFlatListForRender();

    flatList.forEach(item => {
        const li = document.createElement('li');
        li.dataset.id = item.id;
        li.className = `list-item ${item.type.toLowerCase()}-item`;
        li.style.paddingLeft = `${10 + item.depth * 20}px`;
        if (selectedIds.has(item.id)) { li.classList.add('selected'); }
        switch (item.type) {
            case 'CONTROL':
                li.textContent = `${item.data.properties.Name || item.data.properties.LINKS_Name || item.data.properties.Source || item.data.key}`;
                break;
            case 'GROUP':
                li.textContent = `▶ ${item.name}`;
                break;
            case 'PAGE':
                li.textContent = `--- Page: ${item.name} ---`;
                li.style.paddingLeft = '10px';
                break;
        }
        ui.controlsList.appendChild(li);
    });
    updateButtonStates();
    updatePropertyEditor();
};

const updateButtonStates = () => {
    const selectionSize = selectedIds.size;
    const hasSelection = selectionSize > 0;
    const isSingleSelection = selectionSize === 1;

    ui.outputBtn.disabled = tree.children.length === 0;
    ui.groupBtn.disabled = !hasSelection;
    ui.pageBtn.disabled = !isSingleSelection;
    ui.deleteBtn.disabled = !hasSelection;

    if (!hasSelection) {
        ui.moveUpBtn.disabled = true;
        ui.moveDownBtn.disabled = true;
        ui.indentBtn.disabled = true;
        ui.outdentBtn.disabled = true;
        ui.renameBtn.disabled = true;
        return;
    }

    const firstNode = nodeMap.get(Array.from(selectedIds)[0]);
    if(!firstNode) return;

    const canRename = isSingleSelection && ((firstNode.type === 'GROUP' || firstNode.type === 'PAGE') || (firstNode.type === 'CONTROL' && !firstNode.hidden));
    ui.renameBtn.disabled = !canRename;

    if (!isSingleSelection) {
        ui.moveUpBtn.disabled = true;
        ui.moveDownBtn.disabled = true;
        ui.indentBtn.disabled = true;
        ui.outdentBtn.disabled = true;
        return;
    }

    const parent = firstNode.parent;
    const siblings = parent ? parent.children : [];
    const currentIndex = siblings.indexOf(firstNode);

    ui.moveUpBtn.disabled = currentIndex === 0;
    ui.moveDownBtn.disabled = currentIndex === siblings.length - 1;

    const itemAbove = currentIndex > 0 ? siblings[currentIndex - 1] : null;
    const canIndent = itemAbove && itemAbove.type === 'GROUP' && (firstNode.type === 'CONTROL' || firstNode.type === 'GROUP') && firstNode.parent === itemAbove.parent;
    ui.indentBtn.disabled = !canIndent;

    const canOutdent = parent && parent.type === 'GROUP';
    ui.outdentBtn.disabled = !canOutdent;
};

const updatePropertyEditor = () => {
    if (selectedIds.size !== 1) {
        ui.propertyEditor.style.display = 'none';
        ui.noSelection.style.display = 'block';
        return;
    }

    ui.propertyEditor.style.display = 'block';
    ui.noSelection.style.display = 'none';

    const node = nodeMap.get(selectedIds.values().next().value);
    if (!node) return;
    ui.propType.value = node.type;

    switch (node.type) {
        case 'CONTROL':
            ui.propName.value = node.data.properties.Name || node.data.properties.LINKS_Name || '';
            break;
        case 'GROUP':
        case 'PAGE':
            ui.propName.value = node.name;
            break;
    }
};

// --- EVENT HANDLERS ---
ui.openBtn.addEventListener('click', () => {
    addClickFeedback(ui.openBtn);
    ui.fileInput.click();
});

ui.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    originalFilename = file.name;
    const reader = new FileReader();
    reader.onload = (ev) => {
        processInputContent(ev.target.result, originalFilename);
    };
    reader.readAsText(file);
    e.target.value = '';
});

ui.pasteBtn.addEventListener('click', async () => {
    addClickFeedback(ui.pasteBtn);
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            processInputContent(text);
        } else {
            alert('Clipboard is empty or contains no text.');
        }
    } catch (err) {
        alert('Failed to read from clipboard. Please ensure you have granted clipboard access.');
        console.error('Failed to read clipboard contents: ', err);
    }
});

ui.controlsList.addEventListener('click', (e) => {
    const li = e.target.closest('li.list-item');
    if (!li) return;
    const clickedId = parseInt(li.dataset.id, 10);
    const clickedNode = nodeMap.get(clickedId);

    if (e.shiftKey && lastSelectedId !== null) {
        const lastNode = nodeMap.get(lastSelectedId);
        if (clickedNode && lastNode && clickedNode.type === 'CONTROL' && lastNode.type === 'CONTROL' && clickedNode.parent === lastNode.parent) {
            const siblings = clickedNode.parent.children;
            const lastIndex = siblings.indexOf(lastNode);
            const clickedIndex = siblings.indexOf(clickedNode);
            const start = Math.min(lastIndex, clickedIndex);
            const end = Math.max(lastIndex, clickedIndex);

            selectedIds.clear();
            for (let i = start; i <= end; i++) {
                if (siblings[i].type === 'CONTROL' && !siblings[i].hidden) {
                    selectedIds.add(siblings[i].id);
                }
            }
        }
    } else {
        selectedIds.clear();
        selectedIds.add(clickedId);
        lastSelectedId = clickedId;
    }
    render();
});

ui.groupBtn.addEventListener('click', () => {
    addClickFeedback(ui.groupBtn);
    if (selectedIds.size === 0) return;
    const name = prompt("Enter group name:", "New Group");
    if (!name) return;

    const selectedNodes = Array.from(selectedIds).map(id => nodeMap.get(id)).sort((a,b) => a.parent.children.indexOf(a) - b.parent.children.indexOf(b));
    const firstNode = selectedNodes[0];
    const parent = firstNode.parent;
    const siblings = parent.children;
    const firstIndex = siblings.indexOf(firstNode);

    const newGroup = { id: Date.now(), type: 'GROUP', name, parent, children: [], };
    selectedNodes.forEach(node => { node.parent = newGroup; newGroup.children.push(node); });
    const newSiblings = siblings.filter(node => !selectedIds.has(node.id));
    newSiblings.splice(firstIndex, 0, newGroup);
    parent.children = newSiblings;

    selectedIds.clear();
    selectedIds.add(newGroup.id);
    lastSelectedId = newGroup.id;
    render();
});

ui.renameBtn.addEventListener('click', () => {
    addClickFeedback(ui.renameBtn);
    if (selectedIds.size !== 1) return;
    const nodeId = selectedIds.values().next().value;
    const node = nodeMap.get(nodeId);
    if (!node) return;

    if (node.type === 'GROUP' || node.type === 'PAGE') {
        const newName = prompt(`Enter new name for "${node.name}":`, node.name);
        if (newName && newName.trim() !== '') {
            node.name = newName.trim();
            render();
        }
        return;
    }

    if (node.type === 'CONTROL' && !node.hidden) {
        const currentName = (
            node.data && node.data.properties &&
            (node.data.properties.Name || node.data.properties.LINKS_Name || node.data.properties.Source)
        ) || node.data.key || '';

        const newName = prompt(`Enter new name for "${currentName}":`, currentName);
        if (newName && newName.trim() !== '') {
            if (!node.data) node.data = {};
            if (!node.data.properties) node.data.properties = {};
            node.data.properties.Name = newName.trim();
            node.data.__renamed = true;
            render();
        }
        return;
    }
});

ui.pageBtn.addEventListener('click', () => {
    addClickFeedback(ui.pageBtn);
    if (selectedIds.size !== 1) return;
    const name = prompt("Enter page name:", "New Page");
    if (!name) return;

    const selectedNode = nodeMap.get(selectedIds.values().next().value);
    let topLevelNode = selectedNode;
    while (topLevelNode.parent && topLevelNode.parent.type !== 'ROOT') {
        topLevelNode = topLevelNode.parent;
    }

    const siblings = tree.children;
    const index = siblings.indexOf(topLevelNode);
    if (index === -1) return;

    const newPage = { id: Date.now(), type: 'PAGE', name, parent: tree, children: [] };
    siblings.splice(index, 0, newPage);
    render();
});

ui.deleteBtn.addEventListener('click', () => {
    addClickFeedback(ui.deleteBtn);
    if (selectedIds.size === 0) return;

    const nodesToDelete = Array.from(selectedIds).map(id => nodeMap.get(id));
    nodesToDelete.forEach(node => {
        const parent = node.parent;
        if (!parent) return;
        const index = parent.children.indexOf(node);
        if (index === -1) return;

        parent.children.splice(index, 1, ...(node.children || []));
        if (node.children) {
            node.children.forEach(child => child.parent = parent);
        }
    });
    selectedIds.clear();
    lastSelectedId = null;
    render();
});

ui.moveUpBtn.addEventListener('click', () => {
    addClickFeedback(ui.moveUpBtn);
    if (selectedIds.size !== 1) return;
    const nodeId = selectedIds.values().next().value;
    const node = nodeMap.get(nodeId);
    const parent = node.parent;
    if (!parent) return;
    const siblings = parent.children;
    const index = siblings.indexOf(node);
    if (index > 0) {
        [siblings[index - 1], siblings[index]] = [siblings[index], siblings[index - 1]];
        render();
    }
});

ui.moveDownBtn.addEventListener('click', () => {
    addClickFeedback(ui.moveDownBtn);
    if (selectedIds.size !== 1) return;
    const nodeId = selectedIds.values().next().value;
    const node = nodeMap.get(nodeId);
    const parent = node.parent;
    if (!parent) return;
    const siblings = parent.children;
    const index = siblings.indexOf(node);
    if (index < siblings.length - 1) {
        [siblings[index], siblings[index + 1]] = [siblings[index + 1], siblings[index]];
        render();
    }
});

ui.indentBtn.addEventListener('click', () => {
    addClickFeedback(ui.indentBtn);
    if (selectedIds.size !== 1) return;
    const nodeId = selectedIds.values().next().value;
    const node = nodeMap.get(nodeId);
    const parent = node.parent;
    if (!parent) return;

    const siblings = parent.children;
    const index = siblings.indexOf(node);
    if (index > 0) {
        const potentialParent = siblings[index - 1];
        if (potentialParent.type === 'GROUP' && node.parent === potentialParent.parent) {
            siblings.splice(index, 1);
            potentialParent.children.push(node);
            node.parent = potentialParent;
            render();
        }
    }
});

ui.outdentBtn.addEventListener('click', () => {
    addClickFeedback(ui.outdentBtn);
    if (selectedIds.size !== 1) return;
    const nodeId = selectedIds.values().next().value;
    const node = nodeMap.get(nodeId);
    const parent = node.parent;
    if (!parent || parent.type === 'ROOT') return;

    const grandparent = parent.parent;
    const parentSiblings = grandparent.children;
    const parentIndex = parentSiblings.indexOf(parent);

    parent.children.splice(parent.children.indexOf(node), 1);
    parentSiblings.splice(parentIndex + 1, 0, node);
    node.parent = grandparent;
    render();
});

ui.outputBtn.addEventListener('click', () => {
    addClickFeedback(ui.outputBtn);
    try {
        const { content } = generateSettingFile(tree, originalContent, originalFilename, mainOperatorName, mainOperatorType, originalTools, maxAutoLabelIndex);
        ui.outputText.value = content;
    } catch (error) {
        alert(`Error generating output: ${error.message}`);
        console.error('Error during output generation:', error);
    }
});

ui.copyOutputBtn.addEventListener('click', () => {
    addClickFeedback(ui.copyOutputBtn);
    ui.outputText.select();
    navigator.clipboard.writeText(ui.outputText.value)
        .then(() => alert('Output copied to clipboard!'))
        .catch(err => console.error('Failed to copy output: ', err));
});

ui.downloadOutputBtn.addEventListener('click', () => {
    addClickFeedback(ui.downloadOutputBtn);
    try {
        const { content, filename } = generateSettingFile(tree, originalContent, originalFilename, mainOperatorName, mainOperatorType, originalTools, maxAutoLabelIndex);
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch (error) {
        alert(`Error generating file for download: ${error.message}`);
        console.error('Error during file download:', error);
    }
});
