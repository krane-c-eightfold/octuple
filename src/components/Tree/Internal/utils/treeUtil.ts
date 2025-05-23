import React from 'react';
import { omit, toArray } from '../../../../shared/utilities';
import {
  DataNode,
  FlattenNode,
  NodeElement,
  DataEntity,
  Key,
  EventDataNode,
  GetKey,
  FieldNames,
  BasicDataNode,
} from '../OcTree.types';
import { TreeNodeProps } from '../OcTree.types';

export function isTreeNode(node: NodeElement) {
  return node && node.type && node.type.isTreeNode;
}

export function getPosition(level: string | number, index: number) {
  return `${level}-${index}`;
}

export function getKey(key: Key, pos: string) {
  if (key !== null && key !== undefined) {
    return key;
  }
  return pos;
}

export function fillFieldNames(fieldNames?: FieldNames): Required<FieldNames> {
  const { title, _title, key, children } = fieldNames || {};
  const mergedTitle = title || 'title';

  return {
    title: mergedTitle,
    _title: _title || [mergedTitle],
    key: key || 'key',
    children: children || 'children',
  };
}

/**
 * Warning if TreeNode do not provides key
 */
export function warningWithoutKey(
  treeData: DataNode[],
  fieldNames: FieldNames
) {
  const keys: Map<string, boolean> = new Map();

  function dig(list: DataNode[], path: string = '') {
    (list || []).forEach((treeNode) => {
      const key = (treeNode as any)[fieldNames.key];
      const children = (treeNode as any)[fieldNames.children];
      const recordKey = String(key);

      keys.set(recordKey, true);

      dig(children, `${path}${recordKey} > `);
    });
  }

  dig(treeData);
}

/**
 * Convert `children` of Tree into `treeData` structure.
 */
export function convertTreeToData(rootNodes: React.ReactNode): DataNode[] {
  function dig(node: React.ReactNode): DataNode[] {
    const treeNodes = toArray(node) as NodeElement[];
    return treeNodes
      .map((treeNode) => {
        // Filter invalidate node
        if (!isTreeNode(treeNode)) {
          return null;
        }

        const { key } = treeNode;
        const { children, ...rest } = treeNode.props;

        const dataNode: DataNode = {
          key,
          ...rest,
        };

        const parsedChildren = dig(children);
        if (parsedChildren.length) {
          dataNode.children = parsedChildren;
        }

        return dataNode;
      })
      .filter((dataNode: DataNode) => dataNode);
  }

  return dig(rootNodes);
}

/**
 * Flat nest tree data into flatten list. This is used for virtual list render.
 * @param treeNodeList Origin data node list
 * @param expandedKeys
 * need expanded keys, provides `true` means all expanded (used in `tree-select`).
 */
export function flattenTreeData<TreeDataType extends BasicDataNode = DataNode>(
  treeNodeList: TreeDataType[],
  expandedKeys: Key[] | true,
  fieldNames: FieldNames
): FlattenNode<TreeDataType>[] {
  const {
    _title: fieldTitles,
    key: fieldKey,
    children: fieldChildren,
  } = fillFieldNames(fieldNames);

  const expandedKeySet = new Set(expandedKeys === true ? [] : expandedKeys);
  const flattenList: FlattenNode<TreeDataType>[] = [];

  function dig(
    list: TreeDataType[],
    parent: FlattenNode<TreeDataType> = null
  ): FlattenNode<TreeDataType>[] {
    return list.map((treeNode, index) => {
      const pos: string = getPosition(parent ? parent.pos : '0', index);
      const mergedKey = getKey((treeNode as any)[fieldKey], pos);

      // Pick matched title in field title list
      let mergedTitle: React.ReactNode;
      for (let i = 0; i < fieldTitles.length; i += 1) {
        const fieldTitle = fieldTitles[i];
        if ((treeNode as any)[fieldTitle] !== undefined) {
          mergedTitle = (treeNode as any)[fieldTitle];
          break;
        }
      }

      // Add FlattenDataNode into list
      const flattenNode: FlattenNode<TreeDataType> = {
        ...omit(treeNode, [...fieldTitles, fieldKey, fieldChildren] as any),
        title: mergedTitle,
        key: mergedKey,
        parent,
        pos,
        children: null,
        data: treeNode,
        isStart: [...(parent ? parent.isStart : []), index === 0],
        isEnd: [...(parent ? parent.isEnd : []), index === list.length - 1],
      };

      flattenList.push(flattenNode);

      // Loop treeNode children
      if (expandedKeys === true || expandedKeySet.has(mergedKey)) {
        flattenNode.children = dig(
          (treeNode as any)[fieldChildren] || [],
          flattenNode
        );
      } else {
        flattenNode.children = [];
      }

      return flattenNode;
    });
  }

  dig(treeNodeList);

  return flattenList;
}

type ExternalGetKey = GetKey<DataNode> | string;

interface TraverseDataNodesConfig {
  childrenPropName?: string;
  externalGetKey?: ExternalGetKey;
  fieldNames?: FieldNames;
}

/**
 * Traverse all the data by `treeData`.
 * Please not use it out of the `tree` since we may refactor this code.
 */
export function traverseDataNodes(
  dataNodes: DataNode[],
  callback: (data: {
    node: DataNode;
    index: number;
    pos: string;
    key: Key;
    parentPos: string | number;
    level: number;
    nodes: DataNode[];
  }) => void,
  // To avoid too many params, let use config instead of origin param
  config?: TraverseDataNodesConfig | string
) {
  let mergedConfig: TraverseDataNodesConfig = {};
  if (typeof config === 'object') {
    mergedConfig = config;
  } else {
    mergedConfig = { externalGetKey: config };
  }
  mergedConfig = mergedConfig || {};

  // Init config
  const { childrenPropName, externalGetKey, fieldNames } = mergedConfig;

  const { key: fieldKey, children: fieldChildren } = fillFieldNames(fieldNames);

  const mergeChildrenPropName = childrenPropName || fieldChildren;

  // Get keys
  let syntheticGetKey: (node: DataNode, pos?: string) => Key;
  if (externalGetKey) {
    if (typeof externalGetKey === 'string') {
      syntheticGetKey = (node: DataNode) =>
        (node as any)[externalGetKey as string];
    } else if (typeof externalGetKey === 'function') {
      syntheticGetKey = (node: DataNode) =>
        (externalGetKey as GetKey<DataNode>)(node);
    }
  } else {
    syntheticGetKey = (node, pos) => getKey((node as any)[fieldKey], pos);
  }

  // Process
  function processNode(
    node: DataNode,
    index?: number,
    parent?: { node: DataNode; pos: string; level: number },
    pathNodes?: DataNode[]
  ) {
    const children = node ? (node as any)[mergeChildrenPropName] : dataNodes;
    const pos = node ? getPosition(parent.pos, index) : '0';
    const connectNodes = node ? [...pathNodes, node] : [];

    // Process node if is not root
    if (node) {
      const key: Key = syntheticGetKey(node, pos);
      const data = {
        node,
        index,
        pos,
        key,
        parentPos: parent.node ? parent.pos : null,
        level: parent.level + 1,
        nodes: connectNodes,
      };

      callback(data);
    }

    // Process children node
    if (children) {
      children.forEach((subNode: DataNode, subIndex: number) => {
        processNode(
          subNode,
          subIndex,
          {
            node,
            pos,
            level: parent ? parent.level + 1 : -1,
          },
          connectNodes
        );
      });
    }
  }

  processNode(null);
}

interface Wrapper {
  posEntities: Record<string, DataEntity>;
  keyEntities: Record<Key, DataEntity>;
}

/**
 * Convert `treeData` into entity records.
 */
export function convertDataToEntities(
  dataNodes: DataNode[],
  {
    initWrapper,
    processEntity,
    onProcessFinished,
    externalGetKey,
    childrenPropName,
    fieldNames,
  }: {
    initWrapper?: (wrapper: Wrapper) => Wrapper;
    processEntity?: (entity: DataEntity, wrapper: Wrapper) => void;
    onProcessFinished?: (wrapper: Wrapper) => void;
    externalGetKey?: ExternalGetKey;
    childrenPropName?: string;
    fieldNames?: FieldNames;
  } = {}
) {
  // Init config
  const mergedExternalGetKey = externalGetKey;

  const posEntities = {};
  const keyEntities = {};
  let wrapper = {
    posEntities,
    keyEntities,
  };

  if (initWrapper) {
    wrapper = initWrapper(wrapper) || wrapper;
  }

  traverseDataNodes(
    dataNodes,
    (item) => {
      const { node, index, pos, key, parentPos, level, nodes } = item;
      const entity: DataEntity = { node, nodes, index, key, pos, level };

      const mergedKey = getKey(key, pos);

      (posEntities as any)[pos] = entity;
      (keyEntities as any)[mergedKey] = entity;

      // Fill children
      entity.parent = (posEntities as any)[parentPos];
      if (entity.parent) {
        entity.parent.children = entity.parent.children || [];
        entity.parent.children.push(entity);
      }

      if (processEntity) {
        processEntity(entity, wrapper);
      }
    },
    { externalGetKey: mergedExternalGetKey, childrenPropName, fieldNames }
  );

  if (onProcessFinished) {
    onProcessFinished(wrapper);
  }

  return wrapper;
}

export interface TreeNodeRequiredProps<
  TreeDataType extends BasicDataNode = DataNode
> {
  expandedKeys: Key[];
  selectedKeys: Key[];
  loadedKeys: Key[];
  loadingKeys: Key[];
  checkedKeys: Key[];
  halfCheckedKeys: Key[];
  dragOverNodeKey: Key;
  dropPosition: number;
  keyEntities: Record<Key, DataEntity<TreeDataType>>;
}

/**
 * Get TreeNode props with Tree props.
 */
export function getTreeNodeProps<TreeDataType extends BasicDataNode = DataNode>(
  key: Key,
  {
    expandedKeys,
    selectedKeys,
    loadedKeys,
    loadingKeys,
    checkedKeys,
    halfCheckedKeys,
    dragOverNodeKey,
    dropPosition,
    keyEntities,
  }: TreeNodeRequiredProps<TreeDataType>
) {
  const entity = keyEntities[key];

  const treeNodeProps = {
    eventKey: key,
    expanded: expandedKeys.indexOf(key) !== -1,
    selected: selectedKeys.indexOf(key) !== -1,
    loaded: loadedKeys.indexOf(key) !== -1,
    loading: loadingKeys.indexOf(key) !== -1,
    checked: checkedKeys.indexOf(key) !== -1,
    halfChecked: halfCheckedKeys.indexOf(key) !== -1,
    pos: String(entity ? entity.pos : ''),

    // [Legacy] Drag props
    // Since the interaction of drag is changed, the semantic of the props are
    // not accuracy, I think it should be finally removed
    dragOver: dragOverNodeKey === key && dropPosition === 0,
    dragOverGapTop: dragOverNodeKey === key && dropPosition === -1,
    dragOverGapBottom: dragOverNodeKey === key && dropPosition === 1,
  };

  return treeNodeProps;
}

export function convertNodePropsToEventData<
  TreeDataType extends BasicDataNode = DataNode
>(props: TreeNodeProps<TreeDataType>): EventDataNode<TreeDataType> {
  const {
    data,
    expanded,
    selected,
    checked,
    loaded,
    loading,
    halfChecked,
    dragOver,
    dragOverGapTop,
    dragOverGapBottom,
    pos,
    active,
    eventKey,
  } = props;

  const eventData = {
    ...data,
    expanded,
    selected,
    checked,
    loaded,
    loading,
    halfChecked,
    dragOver,
    dragOverGapTop,
    dragOverGapBottom,
    pos,
    active,
    key: eventKey,
  };

  if (!('props' in eventData)) {
    Object.defineProperty(eventData, 'props', {
      get() {
        return props;
      },
    });
  }

  return eventData;
}
