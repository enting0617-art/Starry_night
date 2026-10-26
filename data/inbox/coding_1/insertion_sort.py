#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
插入排序算法实现
时间复杂度：O(n²)
空间复杂度：O(1)
稳定性：稳定
"""

def insertion_sort(arr):
    """
    插入排序：将每个元素插入到已排序部分的正确位置
    类似整理扑克牌的过程
    
    Args:
        arr: 待排序的列表
    Returns:
        排序后的新列表
    """
    n = len(arr)
    # 创建副本避免修改原数组
    result = arr.copy()
    
    # 从第二个元素开始（索引1）
    for i in range(1, n):
        key = result[i]  # 当前要插入的元素
        j = i - 1
        
        # 将比 key 大的元素向后移动
        while j >= 0 and result[j] > key:
            result[j + 1] = result[j]
            j -= 1
        
        # 在正确位置插入 key
        result[j + 1] = key
    
    return result


def insertion_sort_with_print(arr):
    """
    带打印过程的插入排序（用于教学演示）
    
    Args:
        arr: 待排序的列表
    Returns:
        排序后的新列表
    """
    n = len(arr)
    result = arr.copy()
    
    for i in range(1, n):
        key = result[i]
        j = i - 1
        
        while j >= 0 and result[j] > key:
            result[j + 1] = result[j]
            j -= 1
        
        result[j + 1] = key
        print(f"第 {i} 轮插入后：{result}")
    
    return result


if __name__ == "__main__":
    # 测试示例
    test_data = [64, 34, 25, 12, 22, 11, 90]
    print(f"原始数据：{test_data}")
    sorted_data = insertion_sort(test_data)
    print(f"排序结果：{sorted_data}")
