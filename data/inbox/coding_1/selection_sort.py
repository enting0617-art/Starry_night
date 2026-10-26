#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
选择排序算法实现
时间复杂度：O(n²)
空间复杂度：O(1)
稳定性：不稳定
"""

def selection_sort(arr):
    """
    选择排序：每次从未排序部分找到最小元素，放到已排序部分的末尾
    
    Args:
        arr: 待排序的列表
    Returns:
        排序后的新列表
    """
    n = len(arr)
    # 创建副本避免修改原数组
    result = arr.copy()
    
    for i in range(n):
        # 假设当前位置是最小值
        min_idx = i
        
        # 在剩余未排序部分寻找最小元素
        for j in range(i + 1, n):
            if result[j] < result[min_idx]:
                min_idx = j
        
        # 交换找到的最小元素到当前位置
        result[i], result[min_idx] = result[min_idx], result[i]
    
    return result


def selection_sort_with_print(arr):
    """
    带打印过程的选择排序（用于教学演示）
    
    Args:
        arr: 待排序的列表
    Returns:
        排序后的新列表
    """
    n = len(arr)
    result = arr.copy()
    
    for i in range(n):
        min_idx = i
        for j in range(i + 1, n):
            if result[j] < result[min_idx]:
                min_idx = j
        
        result[i], result[min_idx] = result[min_idx], result[i]
        print(f"第 {i+1} 轮选择后：{result}")
    
    return result


if __name__ == "__main__":
    # 测试示例
    test_data = [64, 34, 25, 12, 22, 11, 90]
    print(f"原始数据：{test_data}")
    sorted_data = selection_sort(test_data)
    print(f"排序结果：{sorted_data}")
